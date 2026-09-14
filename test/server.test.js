'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarCamera, montarUrlRtsp, montarUrlMjpeg, cameraPublica } = require('../server');

test('normaliza o caminho e monta a URL RTSP', () => {
    const camera = normalizarCamera({
        nome: 'Entrada', grupo: 'Geral', host: '192.168.0.25', porta: 554,
        caminho: 'live', requerAuth: true, usuario: 'admin', senha: 's@nh:a'
    });
    assert.equal(camera.caminho, '/live');
    assert.equal(montarUrlRtsp(camera), 'rtsp://admin:s%40nh%3Aa@192.168.0.25:554/live');
});

test('mantém a senha anterior ao editar sem informar uma nova', () => {
    const anterior = { senha: 'segredo' };
    const camera = normalizarCamera({
        nome: 'Entrada', grupo: 'Geral', host: 'camera.local', porta: 8554,
        caminho: '/stream', requerAuth: true, usuario: 'admin', senha: ''
    }, anterior);
    assert.equal(camera.senha, 'segredo');
});

test('monta a URL MJPEG usada pelo IP Webcam', () => {
    const camera = normalizarCamera({
        nome: 'Celular', grupo: 'Geral', host: '192.168.0.16', porta: 8080,
        caminho: '/video', tipoFonte: 'mjpeg', requerAuth: false
    });
    assert.equal(camera.tipoFonte, 'mjpeg');
    assert.equal(montarUrlMjpeg(camera), 'http://192.168.0.16:8080/video');
});

test('não expõe senha na resposta pública', () => {
    const publica = cameraPublica({
        id: '1', nome: 'Entrada', grupo: 'Geral', host: '10.0.0.2', porta: 554,
        caminho: '/live', requerAuth: true, usuario: 'admin', senha: 'segredo', streamPath: 'camera-1'
    });
    assert.equal(publica.possuiSenha, true);
    assert.equal('senha' in publica, false);
});

test('rejeita porta fora do intervalo', () => {
    assert.throws(() => normalizarCamera({
        nome: 'Entrada', grupo: 'Geral', host: '10.0.0.2', porta: 70000,
        caminho: '/live', requerAuth: false
    }), /porta/);
});
