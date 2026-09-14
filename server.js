'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { descobrirOnvif, inspecionarOnvif } = require('./lib/onvif');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATABASE_FILE = path.join(DATA_DIR, 'database.json');
const MEDIA_API = process.env.MEDIA_MTX_API || 'http://127.0.0.1:9997';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MEDIA_EXECUTABLE = path.join(ROOT, 'vendor', 'mediamtx', process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx');
const MEDIA_CONFIG = path.join(ROOT, 'mediamtx.yml');
const ONVIF_CACHE_TTL = 5 * 60 * 1000;
const descobertasOnvif = new Map();
const sessoesOnvif = new Map();

const TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function bancoPadrao() {
    return { grupos: ['Geral'], cameras: [] };
}

function carregarBanco() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATABASE_FILE)) return bancoPadrao();
    try {
        const banco = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf8'));
        return {
            grupos: Array.isArray(banco.grupos) && banco.grupos.length ? banco.grupos : ['Geral'],
            cameras: Array.isArray(banco.cameras) ? banco.cameras : []
        };
    } catch {
        throw new Error('O arquivo data/database.json contém JSON inválido.');
    }
}

function salvarBanco(banco) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporario = `${DATABASE_FILE}.tmp`;
    fs.writeFileSync(temporario, `${JSON.stringify(banco, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporario, DATABASE_FILE);
}

function normalizarCamera(entrada, cameraAnterior = null) {
    const nome = String(entrada.nome || '').trim();
    const grupo = String(entrada.grupo || '').trim();
    const host = String(entrada.host || '').trim();
    const porta = Number(entrada.porta);
    let caminho = String(entrada.caminho || '').trim();
    const requerAuth = Boolean(entrada.requerAuth);
    const usuario = requerAuth ? String(entrada.usuario || '').trim() : '';
    const senhaInformada = String(entrada.senha || '');
    const senha = requerAuth ? (senhaInformada || cameraAnterior?.senha || '') : '';
    const tipoFonte = ['rtsp', 'mjpeg'].includes(entrada.tipoFonte)
        ? entrada.tipoFonte
        : (cameraAnterior?.tipoFonte || 'rtsp');
    const protocolo = entrada.protocolo === 'rtsps' ? 'rtsps' : (cameraAnterior?.protocolo || 'rtsp');

    if (!nome || nome.length > 80) throw new Error('Informe um nome de câmera com até 80 caracteres.');
    if (!grupo) throw new Error('Selecione um grupo.');
    if (!host || host.length > 255 || /[\s/@?#]/.test(host)) throw new Error('Informe um IP ou nome de dispositivo válido.');
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new Error('A porta deve estar entre 1 e 65535.');
    if (!caminho.startsWith('/')) caminho = `/${caminho}`;
    if (caminho.length > 500 || /[\r\n]/.test(caminho)) throw new Error('Informe um caminho RTSP válido.');
    if (requerAuth && !usuario) throw new Error('Informe o usuário da câmera.');
    if (requerAuth && !senha) throw new Error('Informe a senha da câmera.');

    return { nome, grupo, host, porta, caminho, tipoFonte, protocolo, requerAuth, usuario, senha };
}

function montarUrlRtsp(camera) {
    const autenticacao = camera.requerAuth
        ? `${encodeURIComponent(camera.usuario)}:${encodeURIComponent(camera.senha)}@`
        : '';
    const host = camera.host.includes(':') && !camera.host.startsWith('[') ? `[${camera.host}]` : camera.host;
    return `${camera.protocolo || 'rtsp'}://${autenticacao}${host}:${camera.porta}${camera.caminho}`;
}

function montarUrlMjpeg(camera) {
    const host = camera.host.includes(':') && !camera.host.startsWith('[') ? `[${camera.host}]` : camera.host;
    return `http://${host}:${camera.porta}${camera.caminho}`;
}

function cabecalhosDaCamera(camera) {
    if (!camera.requerAuth) return {};
    return { Authorization: `Basic ${Buffer.from(`${camera.usuario}:${camera.senha}`).toString('base64')}` };
}

function cameraPublica(camera, status = 'offline') {
    return {
        id: camera.id,
        nome: camera.nome,
        grupo: camera.grupo,
        host: camera.host,
        porta: camera.porta,
        caminho: camera.caminho,
        tipoFonte: camera.tipoFonte || 'rtsp',
        protocolo: camera.protocolo || 'rtsp',
        requerAuth: camera.requerAuth,
        usuario: camera.usuario,
        possuiSenha: Boolean(camera.senha),
        streamPath: camera.streamPath,
        status
    };
}

async function mediaFetch(endpoint, opcoes = {}) {
    return fetch(`${MEDIA_API}${endpoint}`, {
        signal: AbortSignal.timeout(2500),
        headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
        ...opcoes
    });
}

async function mediaDisponivel() {
    try {
        return (await mediaFetch('/v3/paths/list')).ok;
    } catch {
        return false;
    }
}

async function obterStatus(camera) {
    try {
        const resposta = await mediaFetch(`/v3/paths/get/${encodeURIComponent(camera.streamPath)}`);
        if (!resposta.ok) return 'offline';
        const caminho = await resposta.json();
        return caminho.available || caminho.ready ? 'online' : 'offline';
    } catch {
        return 'servidor-indisponivel';
    }
}

async function obterStatusMjpeg(camera) {
    try {
        const resposta = await fetch(montarUrlMjpeg(camera), {
            headers: cabecalhosDaCamera(camera),
            signal: AbortSignal.timeout(3000)
        });
        if (resposta.body) await resposta.body.cancel();
        return resposta.ok ? 'online' : 'offline';
    } catch {
        return 'offline';
    }
}

async function transmitirMjpeg(req, res, camera) {
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 5000);
    req.once('close', () => controlador.abort());

    try {
        const resposta = await fetch(montarUrlMjpeg(camera), {
            headers: cabecalhosDaCamera(camera),
            signal: controlador.signal
        });
        clearTimeout(timeout);

        if (!resposta.ok || !resposta.body) {
            controlador.abort();
            return responderJson(res, 502, { erro: `A câmera respondeu com HTTP ${resposta.status}.` });
        }

        res.writeHead(200, {
            'Content-Type': resposta.headers.get('content-type') || 'multipart/x-mixed-replace',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache'
        });
        Readable.fromWeb(resposta.body).on('error', () => res.end()).pipe(res);
    } catch {
        clearTimeout(timeout);
        if (!res.headersSent) responderJson(res, 502, { erro: 'Não foi possível acessar o vídeo MJPEG da câmera.' });
        else res.end();
    }
}

async function sincronizarComMediaMtx(camera) {
    const nome = encodeURIComponent(camera.streamPath);
    const configuracao = {
        source: montarUrlRtsp(camera),
        sourceOnDemand: true,
        rtspTransport: 'tcp'
    };

    const consulta = await mediaFetch(`/v3/config/paths/get/${nome}`);
    const endpoint = consulta.ok ? `/v3/config/paths/patch/${nome}` : `/v3/config/paths/add/${nome}`;
    const resposta = await mediaFetch(endpoint, {
        method: consulta.ok ? 'PATCH' : 'POST',
        body: JSON.stringify(configuracao)
    });
    if (!resposta.ok) {
        const detalhes = await resposta.text();
        throw new Error(`MediaMTX recusou a configuração${detalhes ? `: ${detalhes}` : '.'}`);
    }
}

async function removerDoMediaMtx(camera) {
    try {
        await mediaFetch(`/v3/config/paths/delete/${encodeURIComponent(camera.streamPath)}`, { method: 'DELETE' });
    } catch {
        // A remoção local não deve ficar bloqueada se o MediaMTX estiver desligado.
    }
}

function responderJson(res, status, corpo) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(corpo));
}

async function lerJson(req) {
    const partes = [];
    let tamanho = 0;
    for await (const parte of req) {
        tamanho += parte.length;
        if (tamanho > 64 * 1024) throw new Error('O corpo da requisição é grande demais.');
        partes.push(parte);
    }
    if (!partes.length) return {};
    try {
        return JSON.parse(Buffer.concat(partes).toString('utf8'));
    } catch {
        throw new Error('JSON inválido.');
    }
}

function limparCachesOnvif() {
    const agora = Date.now();
    for (const [id, item] of descobertasOnvif) if (item.expiraEm <= agora) descobertasOnvif.delete(id);
    for (const [id, item] of sessoesOnvif) if (item.expiraEm <= agora) sessoesOnvif.delete(id);
}

function obterItemTemporario(cache, id) {
    limparCachesOnvif();
    return cache.get(String(id || ''));
}

async function tratarApi(req, res, url) {
    const banco = carregarBanco();

    if (req.method === 'POST' && url.pathname === '/api/onvif/descobrir') {
        const dispositivos = await descobrirOnvif({ timeoutMs: 4000 });
        limparCachesOnvif();
        const resultado = dispositivos.map(dispositivo => {
            const id = crypto.randomUUID();
            descobertasOnvif.set(id, { dispositivo, expiraEm: Date.now() + ONVIF_CACHE_TTL });
            return {
                id,
                nome: dispositivo.nome,
                ip: dispositivo.ip,
                hardware: dispositivo.hardware,
                localizacao: dispositivo.localizacao,
                endpoint: dispositivo.endpoint
            };
        });
        return responderJson(res, 200, { dispositivos: resultado, duracaoCacheSegundos: ONVIF_CACHE_TTL / 1000 });
    }

    if (req.method === 'POST' && url.pathname === '/api/onvif/inspecionar') {
        const entrada = await lerJson(req);
        const descoberta = obterItemTemporario(descobertasOnvif, entrada.discoveryId);
        if (!descoberta) return responderJson(res, 410, { erro: 'A descoberta expirou. Busque as câmeras novamente.' });
        const inspecao = await inspecionarOnvif(descoberta.dispositivo, entrada.usuario, entrada.senha);
        const sessionId = crypto.randomUUID();
        sessoesOnvif.set(sessionId, {
            dispositivo: descoberta.dispositivo,
            inspecao,
            usuario: String(entrada.usuario || ''),
            senha: String(entrada.senha || ''),
            expiraEm: Date.now() + ONVIF_CACHE_TTL
        });
        return responderJson(res, 200, {
            sessionId,
            fabricante: inspecao.fabricante,
            modelo: inspecao.modelo,
            firmware: inspecao.firmware,
            serial: inspecao.serial,
            perfis: inspecao.perfis.map(perfil => ({
                token: perfil.token,
                nome: perfil.nome,
                codec: perfil.codec,
                largura: perfil.largura,
                altura: perfil.altura,
                fps: perfil.fps,
                bitrateKbps: perfil.bitrateKbps,
                disponivel: Boolean(perfil.stream),
                erro: perfil.erro || ''
            }))
        });
    }

    if (req.method === 'POST' && url.pathname === '/api/onvif/importar') {
        const entrada = await lerJson(req);
        const sessao = obterItemTemporario(sessoesOnvif, entrada.sessionId);
        if (!sessao) return responderJson(res, 410, { erro: 'A sessão ONVIF expirou. Faça a descoberta novamente.' });
        const perfil = sessao.inspecao.perfis.find(item => item.token === entrada.profileToken && item.stream);
        if (!perfil) return responderJson(res, 400, { erro: 'Selecione um perfil de vídeo válido.' });
        if (!banco.grupos.includes(entrada.grupo)) return responderJson(res, 400, { erro: 'O grupo selecionado não existe.' });

        const dados = normalizarCamera({
            nome: entrada.nome || `${sessao.inspecao.fabricante} ${sessao.inspecao.modelo}`.trim(),
            grupo: entrada.grupo,
            host: perfil.stream.host,
            porta: perfil.stream.porta,
            caminho: perfil.stream.caminho,
            tipoFonte: 'rtsp',
            protocolo: perfil.stream.protocolo,
            requerAuth: Boolean(sessao.usuario),
            usuario: sessao.usuario,
            senha: sessao.senha
        });
        const id = crypto.randomUUID();
        const camera = {
            id, ...dados, streamPath: `camera-${id}`, criadaEm: new Date().toISOString(),
            onvif: {
                fabricante: sessao.inspecao.fabricante,
                modelo: sessao.inspecao.modelo,
                serial: sessao.inspecao.serial,
                profileToken: perfil.token
            }
        };
        banco.cameras.push(camera);
        salvarBanco(banco);
        sessoesOnvif.delete(entrada.sessionId);
        try {
            await sincronizarComMediaMtx(camera);
            return responderJson(res, 201, { camera: cameraPublica(camera), mensagem: 'Câmera ONVIF importada e conectada.' });
        } catch {
            return responderJson(res, 201, {
                camera: cameraPublica(camera, 'servidor-indisponivel'),
                aviso: 'Câmera ONVIF importada, mas o MediaMTX não respondeu.'
            });
        }
    }

    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
        const disponivel = await mediaDisponivel();
        const estados = await Promise.all(banco.cameras.map(camera => {
            if ((camera.tipoFonte || 'rtsp') === 'mjpeg') return obterStatusMjpeg(camera);
            return disponivel ? obterStatus(camera) : 'servidor-indisponivel';
        }));
        return responderJson(res, 200, {
            grupos: banco.grupos,
            cameras: banco.cameras.map((camera, indice) => cameraPublica(camera, estados[indice])),
            mediaServerDisponivel: disponivel
        });
    }

    if (req.method === 'POST' && url.pathname === '/api/grupos') {
        const entrada = await lerJson(req);
        const nome = String(entrada.nome || '').trim();
        if (!nome || nome.length > 60) return responderJson(res, 400, { erro: 'Informe um nome de grupo com até 60 caracteres.' });
        if (banco.grupos.some(grupo => grupo.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) {
            return responderJson(res, 409, { erro: 'Esse grupo já existe.' });
        }
        banco.grupos.push(nome);
        salvarBanco(banco);
        return responderJson(res, 201, { nome });
    }

    const grupoMatch = url.pathname.match(/^\/api\/grupos\/(.+)$/);
    if (req.method === 'DELETE' && grupoMatch) {
        const nome = decodeURIComponent(grupoMatch[1]);
        if (nome === 'Geral') return responderJson(res, 400, { erro: 'O grupo Geral não pode ser excluído.' });
        if (banco.cameras.some(camera => camera.grupo === nome)) return responderJson(res, 409, { erro: 'Mova ou exclua as câmeras deste grupo primeiro.' });
        if (!banco.grupos.includes(nome)) return responderJson(res, 404, { erro: 'Grupo não encontrado.' });
        banco.grupos = banco.grupos.filter(grupo => grupo !== nome);
        salvarBanco(banco);
        return responderJson(res, 200, { mensagem: 'Grupo excluído.' });
    }

    if (req.method === 'POST' && url.pathname === '/api/cameras') {
        const entrada = await lerJson(req);
        const dados = normalizarCamera(entrada);
        if (!banco.grupos.includes(dados.grupo)) return responderJson(res, 400, { erro: 'O grupo selecionado não existe.' });
        const id = crypto.randomUUID();
        const camera = { id, ...dados, streamPath: `camera-${id}`, criadaEm: new Date().toISOString() };
        banco.cameras.push(camera);
        salvarBanco(banco);
        if (camera.tipoFonte === 'mjpeg') {
            const status = await obterStatusMjpeg(camera);
            return responderJson(res, 201, {
                camera: cameraPublica(camera, status),
                mensagem: 'Câmera MJPEG cadastrada.'
            });
        }
        try {
            await sincronizarComMediaMtx(camera);
            return responderJson(res, 201, { camera: cameraPublica(camera), mensagem: 'Câmera cadastrada.' });
        } catch {
            return responderJson(res, 201, { camera: cameraPublica(camera, 'servidor-indisponivel'), aviso: 'Câmera salva. Inicie o MediaMTX e use Reconectar.' });
        }
    }

    const sincronizarMatch = url.pathname.match(/^\/api\/cameras\/([^/]+)\/sincronizar$/);
    if (req.method === 'POST' && sincronizarMatch) {
        const camera = banco.cameras.find(item => item.id === decodeURIComponent(sincronizarMatch[1]));
        if (!camera) return responderJson(res, 404, { erro: 'Câmera não encontrada.' });
        if ((camera.tipoFonte || 'rtsp') === 'mjpeg') {
            const status = await obterStatusMjpeg(camera);
            if (status === 'online') return responderJson(res, 200, { mensagem: 'A transmissão MJPEG está respondendo.' });
            return responderJson(res, 503, { erro: 'O vídeo MJPEG não respondeu. Confirme se o servidor do IP Webcam está iniciado.' });
        }
        try {
            await sincronizarComMediaMtx(camera);
            return responderJson(res, 200, { mensagem: 'Configuração enviada. A conexão será verificada.' });
        } catch {
            return responderJson(res, 503, { erro: 'Não foi possível acessar o MediaMTX. Verifique se ele está em execução.' });
        }
    }

    const mjpegMatch = url.pathname.match(/^\/api\/cameras\/([^/]+)\/mjpeg$/);
    if (req.method === 'GET' && mjpegMatch) {
        const camera = banco.cameras.find(item => item.id === decodeURIComponent(mjpegMatch[1]));
        if (!camera) return responderJson(res, 404, { erro: 'Câmera não encontrada.' });
        if ((camera.tipoFonte || 'rtsp') !== 'mjpeg') return responderJson(res, 400, { erro: 'Esta câmera não utiliza MJPEG.' });
        return transmitirMjpeg(req, res, camera);
    }

    const cameraMatch = url.pathname.match(/^\/api\/cameras\/([^/]+)$/);
    if (cameraMatch) {
        const id = decodeURIComponent(cameraMatch[1]);
        const indice = banco.cameras.findIndex(item => item.id === id);
        if (indice < 0) return responderJson(res, 404, { erro: 'Câmera não encontrada.' });

        if (req.method === 'PUT') {
            const entrada = await lerJson(req);
            const cameraAnterior = banco.cameras[indice];
            const dados = normalizarCamera(entrada, cameraAnterior);
            if (!banco.grupos.includes(dados.grupo)) return responderJson(res, 400, { erro: 'O grupo selecionado não existe.' });
            banco.cameras[indice] = { ...cameraAnterior, ...dados };
            salvarBanco(banco);
            if (dados.tipoFonte === 'mjpeg') {
                await removerDoMediaMtx(cameraAnterior);
                const status = await obterStatusMjpeg(banco.cameras[indice]);
                return responderJson(res, 200, {
                    camera: cameraPublica(banco.cameras[indice], status),
                    mensagem: 'Câmera MJPEG atualizada.'
                });
            }
            try {
                await sincronizarComMediaMtx(banco.cameras[indice]);
                return responderJson(res, 200, { camera: cameraPublica(banco.cameras[indice]), mensagem: 'Câmera atualizada.' });
            } catch {
                return responderJson(res, 200, { camera: cameraPublica(banco.cameras[indice], 'servidor-indisponivel'), aviso: 'Alterações salvas, mas o MediaMTX não respondeu.' });
            }
        }

        if (req.method === 'DELETE') {
            const [camera] = banco.cameras.splice(indice, 1);
            salvarBanco(banco);
            await removerDoMediaMtx(camera);
            return responderJson(res, 200, { mensagem: 'Câmera excluída.' });
        }
    }

    return responderJson(res, 404, { erro: 'Rota da API não encontrada.' });
}

function servirArquivo(res, pathname) {
    const relativo = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const arquivo = path.resolve(ROOT, relativo);
    const arquivoIndex = path.join(ROOT, 'index.html');
    const raizCss = `${path.join(ROOT, 'css')}${path.sep}`;
    const raizScript = `${path.join(ROOT, 'script')}${path.sep}`;
    const permitido = arquivo === arquivoIndex || arquivo.startsWith(raizCss) || arquivo.startsWith(raizScript);
    if (!permitido) {
        responderJson(res, 404, { erro: 'Arquivo não encontrado.' });
        return;
    }
    if (!fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
        responderJson(res, 404, { erro: 'Arquivo não encontrado.' });
        return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(arquivo).pipe(res);
}

async function tratarRequisicao(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
        if (url.pathname.startsWith('/api/')) return await tratarApi(req, res, url);
        if (!['GET', 'HEAD'].includes(req.method)) return responderJson(res, 405, { erro: 'Método não permitido.' });
        return servirArquivo(res, decodeURIComponent(url.pathname));
    } catch (erro) {
        console.error(erro);
        return responderJson(res, 400, { erro: erro.message || 'Erro interno.' });
    }
}

function iniciarMediaMtx() {
    if (!fs.existsSync(MEDIA_EXECUTABLE)) {
        console.warn('MediaMTX não instalado. Execute: npm run setup');
        return null;
    }
    const processo = spawn(MEDIA_EXECUTABLE, [MEDIA_CONFIG], { cwd: path.dirname(MEDIA_EXECUTABLE), windowsHide: true });
    processo.stdout.on('data', dados => process.stdout.write(`[MediaMTX] ${dados}`));
    processo.stderr.on('data', dados => process.stderr.write(`[MediaMTX] ${dados}`));
    processo.on('error', erro => console.warn(`Não foi possível iniciar o MediaMTX: ${erro.message}`));
    processo.on('exit', codigo => {
        if (codigo && codigo !== 0) console.warn(`MediaMTX finalizado com código ${codigo}. Talvez já exista outra instância em execução.`);
    });
    return processo;
}

function sincronizarAoIniciar() {
    setTimeout(async () => {
        if (!(await mediaDisponivel())) return;
        const banco = carregarBanco();
        for (const camera of banco.cameras) {
            if ((camera.tipoFonte || 'rtsp') !== 'rtsp') continue;
            try {
                await sincronizarComMediaMtx(camera);
            } catch (erro) {
                console.warn(`Falha ao sincronizar ${camera.nome}: ${erro.message}`);
            }
        }
    }, 1000);
}

function iniciar() {
    const processoMedia = iniciarMediaMtx();
    const servidor = http.createServer(tratarRequisicao);
    servidor.listen(PORT, HOST, () => {
        console.log(`Painel disponível em http://${HOST}:${PORT}`);
        sincronizarAoIniciar();
    });

    function encerrar() {
        servidor.close();
        if (processoMedia && !processoMedia.killed) processoMedia.kill('SIGINT');
    }
    process.once('SIGINT', encerrar);
    process.once('SIGTERM', encerrar);
}

if (require.main === module) iniciar();

module.exports = { normalizarCamera, montarUrlRtsp, montarUrlMjpeg, cameraPublica, tratarRequisicao };
