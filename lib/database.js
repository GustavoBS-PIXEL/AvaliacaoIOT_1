'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const LEGACY_FILE = path.join(DATA_DIR, 'database.json');
const KEY_FILE = path.join(DATA_DIR, 'app.key');
const DB_NAME = process.env.DB_NAME || 'painel_seguranca_iot';
let pool;
let encryptionKey;

async function colunaExiste(tabela, coluna) {
    const [rows] = await pool.execute(`SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [DB_NAME, tabela, coluna]);
    return rows.length > 0;
}

function validarNomeBanco(nome) {
    if (!/^[a-zA-Z0-9_]+$/.test(nome)) throw new Error('DB_NAME deve conter apenas letras, números e underscore.');
    return nome;
}

function obterChave() {
    if (encryptionKey) return encryptionKey;
    const configured = process.env.APP_ENCRYPTION_KEY;
    if (configured) {
        const decoded = Buffer.from(configured, 'base64');
        if (decoded.length !== 32) throw new Error('APP_ENCRYPTION_KEY deve ser uma chave de 32 bytes em Base64.');
        encryptionKey = decoded;
        return encryptionKey;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    const decoded = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
    if (decoded.length !== 32) throw new Error('A chave local data/app.key é inválida.');
    encryptionKey = decoded;
    return encryptionKey;
}

function cifrar(valor) {
    if (!valor) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', obterChave(), iv);
    const encrypted = Buffer.concat([cipher.update(String(valor), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decifrar(valor) {
    if (!valor) return '';
    const data = Buffer.from(valor, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', obterChave(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

async function inicializarBanco() {
    const database = validarNomeBanco(DB_NAME);
    const config = {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        charset: 'utf8mb4'
    };
    const connection = await mysql.createConnection(config);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.end();
    pool = mysql.createPool({ ...config, database, waitForConnections: true, connectionLimit: 10 });

    await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id CHAR(36) PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        email VARCHAR(190) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash CHAR(64) PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        csrf_token CHAR(48) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sessions_user (user_id),
        INDEX idx_sessions_expiry (expires_at),
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS camera_groups (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        name VARCHAR(60) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_group_user_name (user_id, name),
        CONSTRAINT fk_groups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS cameras (
        id CHAR(36) PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        group_name VARCHAR(60) NOT NULL,
        name VARCHAR(80) NOT NULL,
        host VARCHAR(255) NOT NULL,
        port SMALLINT UNSIGNED NOT NULL,
        path VARCHAR(500) NOT NULL,
        source_type ENUM('rtsp','mjpeg','hls') NOT NULL DEFAULT 'rtsp',
        connection_mode ENUM('gateway','cloud') NOT NULL DEFAULT 'gateway',
        protocol ENUM('rtsp','rtsps','http','https') NOT NULL DEFAULT 'rtsp',
        requires_auth BOOLEAN NOT NULL DEFAULT FALSE,
        camera_user VARCHAR(190) NOT NULL DEFAULT '',
        camera_password TEXT NULL,
        stream_path VARCHAR(80) NOT NULL UNIQUE,
        onvif_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cameras_user (user_id),
        CONSTRAINT fk_cameras_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    if (!(await colunaExiste('cameras', 'connection_mode'))) {
        await pool.query("ALTER TABLE cameras ADD COLUMN connection_mode ENUM('gateway','cloud') NOT NULL DEFAULT 'gateway' AFTER source_type");
    }
    await pool.query("ALTER TABLE cameras MODIFY source_type ENUM('rtsp','mjpeg','hls') NOT NULL DEFAULT 'rtsp'");
    await pool.query("ALTER TABLE cameras MODIFY protocol ENUM('rtsp','rtsps','http','https') NOT NULL DEFAULT 'rtsp'");
    await pool.query("UPDATE cameras SET protocol='http' WHERE source_type='mjpeg' AND protocol IN ('rtsp','rtsps')");
    await pool.query(`CREATE TABLE IF NOT EXISTS view_presets (
        id CHAR(36) PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        name VARCHAR(80) NOT NULL,
        config_json JSON NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_view_preset_name (user_id, name),
        INDEX idx_view_presets_user (user_id),
        CONSTRAINT fk_view_presets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
    obterChave();
}

function banco() {
    if (!pool) throw new Error('O banco de dados ainda não foi inicializado.');
    return pool;
}

function mapearCamera(row) {
    return {
        id: row.id, nome: row.name, grupo: row.group_name, host: row.host,
        porta: Number(row.port), caminho: row.path, tipoFonte: row.source_type,
        modoConexao: row.connection_mode || 'gateway',
        protocolo: row.protocol, requerAuth: Boolean(row.requires_auth),
        usuario: row.camera_user || '', senha: decifrar(row.camera_password),
        streamPath: row.stream_path, criadaEm: row.created_at,
        onvif: typeof row.onvif_json === 'string' ? JSON.parse(row.onvif_json) : row.onvif_json
    };
}

async function listarDados(userId) {
    const [groupResult, cameraResult] = await Promise.all([
        banco().query('SELECT name FROM camera_groups WHERE user_id = ? ORDER BY id', [userId]),
        banco().query('SELECT * FROM cameras WHERE user_id = ? ORDER BY created_at', [userId])
    ]);
    const groupRows = groupResult[0];
    const cameraRows = cameraResult[0];
    return { grupos: groupRows.map(row => row.name), cameras: cameraRows.map(mapearCamera) };
}

async function listarTodasCameras() {
    const [rows] = await banco().query('SELECT * FROM cameras ORDER BY created_at');
    return rows.map(mapearCamera);
}

async function obterCamera(userId, id) {
    const [rows] = await banco().query('SELECT * FROM cameras WHERE user_id = ? AND id = ? LIMIT 1', [userId, id]);
    return rows[0] ? mapearCamera(rows[0]) : null;
}

async function criarCamera(userId, camera) {
    await banco().execute(`INSERT INTO cameras
        (id, user_id, group_name, name, host, port, path, source_type, connection_mode, protocol, requires_auth, camera_user, camera_password, stream_path, onvif_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        camera.id, userId, camera.grupo, camera.nome, camera.host, camera.porta, camera.caminho,
        camera.tipoFonte || 'rtsp', camera.modoConexao || 'gateway', camera.protocolo || 'rtsp', Boolean(camera.requerAuth), camera.usuario || '', cifrar(camera.senha),
        camera.streamPath, camera.onvif ? JSON.stringify(camera.onvif) : null
    ]);
}

async function atualizarCamera(userId, camera) {
    const [result] = await banco().execute(`UPDATE cameras SET group_name=?, name=?, host=?, port=?, path=?, source_type=?, connection_mode=?,
        protocol=?, requires_auth=?, camera_user=?, camera_password=? WHERE user_id=? AND id=?`, [
        camera.grupo, camera.nome, camera.host, camera.porta, camera.caminho, camera.tipoFonte,
        camera.modoConexao || 'gateway', camera.protocolo, camera.requerAuth, camera.usuario, cifrar(camera.senha), userId, camera.id
    ]);
    return result.affectedRows > 0;
}

async function excluirCamera(userId, id) {
    const camera = await obterCamera(userId, id);
    if (!camera) return null;
    await banco().execute('DELETE FROM cameras WHERE user_id = ? AND id = ?', [userId, id]);
    return camera;
}

async function grupoExiste(userId, nome) {
    const [rows] = await banco().execute('SELECT 1 FROM camera_groups WHERE user_id = ? AND name = ? LIMIT 1', [userId, nome]);
    return rows.length > 0;
}

async function criarGrupo(userId, nome) {
    await banco().execute('INSERT INTO camera_groups (user_id, name) VALUES (?, ?)', [userId, nome]);
}

async function excluirGrupo(userId, nome) {
    const [cameras] = await banco().execute('SELECT 1 FROM cameras WHERE user_id = ? AND group_name = ? LIMIT 1', [userId, nome]);
    if (cameras.length) return 'em-uso';
    const [result] = await banco().execute('DELETE FROM camera_groups WHERE user_id = ? AND name = ?', [userId, nome]);
    return result.affectedRows ? 'excluido' : 'inexistente';
}

function mapearVisualizacao(row) {
    const config = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
    return {
        id: row.id,
        nome: row.name,
        grupos: Array.isArray(config?.grupos) ? config.grupos : [],
        cameraIds: Array.isArray(config?.cameraIds) ? config.cameraIds : []
    };
}

async function listarVisualizacoes(userId) {
    const [rows] = await banco().execute('SELECT id, name, config_json FROM view_presets WHERE user_id = ? ORDER BY name', [userId]);
    return rows.map(mapearVisualizacao);
}

async function criarVisualizacao(userId, visualizacao) {
    await banco().execute('INSERT INTO view_presets (id, user_id, name, config_json) VALUES (?, ?, ?, ?)', [
        visualizacao.id, userId, visualizacao.nome, JSON.stringify({ grupos: visualizacao.grupos, cameraIds: visualizacao.cameraIds })
    ]);
}

async function atualizarVisualizacao(userId, visualizacao) {
    const [result] = await banco().execute('UPDATE view_presets SET name = ?, config_json = ? WHERE user_id = ? AND id = ?', [
        visualizacao.nome, JSON.stringify({ grupos: visualizacao.grupos, cameraIds: visualizacao.cameraIds }), userId, visualizacao.id
    ]);
    return result.affectedRows > 0;
}

async function excluirVisualizacao(userId, id) {
    const [result] = await banco().execute('DELETE FROM view_presets WHERE user_id = ? AND id = ?', [userId, id]);
    return result.affectedRows > 0;
}

async function importarLegado(userId) {
    const [countRows] = await banco().query('SELECT COUNT(*) AS total FROM cameras');
    if (Number(countRows[0].total) || !fs.existsSync(LEGACY_FILE)) return false;
    let legacy;
    try { legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')); } catch { return false; }
    for (const nome of Array.isArray(legacy.grupos) ? legacy.grupos : []) {
        if (nome && nome !== 'Geral') await banco().execute('INSERT IGNORE INTO camera_groups (user_id, name) VALUES (?, ?)', [userId, String(nome).slice(0, 60)]);
    }
    for (const raw of Array.isArray(legacy.cameras) ? legacy.cameras : []) {
        try {
            const camera = { ...raw, id: raw.id || crypto.randomUUID(), streamPath: raw.streamPath || `camera-${crypto.randomUUID()}` };
            if (!(await grupoExiste(userId, camera.grupo))) camera.grupo = 'Geral';
            await criarCamera(userId, camera);
        } catch (error) {
            console.warn(`Câmera antiga não importada: ${error.message}`);
        }
    }
    fs.renameSync(LEGACY_FILE, `${LEGACY_FILE}.migrated`);
    return true;
}

module.exports = {
    inicializarBanco, banco, listarDados, listarTodasCameras, obterCamera, criarCamera, atualizarCamera, excluirCamera,
    grupoExiste, criarGrupo, excluirGrupo, listarVisualizacoes, criarVisualizacao, atualizarVisualizacao,
    excluirVisualizacao, importarLegado
};
