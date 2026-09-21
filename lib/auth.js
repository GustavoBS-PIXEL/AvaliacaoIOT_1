'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { banco, criarGrupo, importarLegado } = require('./database');

const SESSION_COOKIE = 'iot_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const attempts = new Map();

function normalizarEmail(value) {
    return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function validarCadastro(input) {
    const nome = String(input.nome || '').trim().replace(/\s+/g, ' ');
    const email = normalizarEmail(input.email);
    const senha = String(input.senha || '');
    if (nome.length < 2 || nome.length > 80) throw new Error('Informe um nome entre 2 e 80 caracteres.');
    if (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
    if (senha.length < 10 || senha.length > 128 || !/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) {
        throw new Error('A senha deve ter de 10 a 128 caracteres, com pelo menos uma letra e um número.');
    }
    return { nome, email, senha };
}

function cookies(req) {
    return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2));
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function cookieSeguro(req) {
    return Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
}

function definirCookie(req, res, token, maxAgeSeconds) {
    const secure = cookieSeguro(req) ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
}

async function criarSessao(req, res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await banco().execute('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)', [hashToken(token), userId, csrfToken, expiresAt]);
    definirCookie(req, res, token, Math.floor(SESSION_DURATION_MS / 1000));
    return csrfToken;
}

async function registrar(req, res, input) {
    const ipKey = `register:${req.socket.remoteAddress || 'local'}`;
    const now = Date.now();
    const registerLimit = attempts.get(ipKey);
    if (registerLimit && registerLimit.resetAt > now && registerLimit.count >= 5) {
        throw Object.assign(new Error('Muitas contas foram criadas recentemente. Aguarde antes de tentar novamente.'), { status: 429 });
    }
    const { nome, email, senha } = validarCadastro(input);
    const [existing] = await banco().execute('SELECT 1 FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) return { erro: 'Já existe uma conta com este e-mail.', status: 409 };
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(senha, 12);
    try {
        await banco().execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [id, nome, email, passwordHash]);
        await criarGrupo(id, 'Geral');
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return { erro: 'Já existe uma conta com este e-mail.', status: 409 };
        await banco().execute('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
        throw error;
    }
    const csrfToken = await criarSessao(req, res, id).catch(async error => {
        await banco().execute('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
        throw error;
    });
    attempts.set(ipKey, { count: (registerLimit?.resetAt > now ? registerLimit.count : 0) + 1, resetAt: registerLimit?.resetAt > now ? registerLimit.resetAt : now + 60 * 60 * 1000 });
    await importarLegado(id).catch(error => console.warn(`Não foi possível importar o cadastro antigo: ${error.message}`));
    return { usuario: { id, nome, email }, csrfToken };
}

function chaveTentativa(req, email) {
    return `${req.socket.remoteAddress || 'local'}:${email}`;
}

function verificarLimite(req, email) {
    const key = chaveTentativa(req, email);
    const now = Date.now();
    const item = attempts.get(key);
    if (!item || item.resetAt <= now) return { key, count: 0, resetAt: now + 15 * 60 * 1000 };
    if (item.count >= 8) throw Object.assign(new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.'), { status: 429 });
    return { key, ...item };
}

async function entrar(req, res, input) {
    const email = normalizarEmail(input.email);
    const senha = String(input.senha || '');
    const limit = verificarLimite(req, email);
    const [rows] = await banco().execute('SELECT id, name, email, password_hash FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    const valid = user ? await bcrypt.compare(senha, user.password_hash) : await bcrypt.compare(senha, '$2b$12$JqTFAcsWf/9nP.Lpy8pVeuLY2Oi0EvmByf0mIHhqvXza9Vn1y9F2S');
    if (!valid) {
        attempts.set(limit.key, { count: limit.count + 1, resetAt: limit.resetAt });
        return { erro: 'E-mail ou senha incorretos.', status: 401 };
    }
    attempts.delete(limit.key);
    const csrfToken = await criarSessao(req, res, user.id);
    return { usuario: { id: user.id, nome: user.name, email: user.email }, csrfToken };
}

async function autenticar(req) {
    const token = cookies(req)[SESSION_COOKIE];
    if (!token) return null;
    const [rows] = await banco().execute(`SELECT s.token_hash, s.csrf_token, u.id, u.name, u.email
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > NOW() LIMIT 1`, [hashToken(token)]);
    if (!rows[0]) return null;
    return { tokenHash: rows[0].token_hash, csrfToken: rows[0].csrf_token, usuario: { id: rows[0].id, nome: rows[0].name, email: rows[0].email } };
}

function validarCsrf(req, auth) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const provided = String(req.headers['x-csrf-token'] || '');
    if (!provided || provided.length !== auth.csrfToken.length) return false;
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(auth.csrfToken));
}

async function sair(req, res, auth) {
    if (auth) await banco().execute('DELETE FROM sessions WHERE token_hash = ?', [auth.tokenHash]);
    definirCookie(req, res, '', 0);
}

module.exports = { registrar, entrar, autenticar, validarCsrf, sair };
