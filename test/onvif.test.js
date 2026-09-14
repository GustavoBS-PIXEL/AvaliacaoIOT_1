'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { analisarMensagemDiscovery, decomporRtsp, escaparXml, inspecionarOnvif } = require('../lib/onvif');

test('interpreta uma resposta WS-Discovery de câmera ONVIF', () => {
    const xml = `<?xml version="1.0"?>
    <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
      <s:Body><d:ProbeMatches><d:ProbeMatch>
        <a:EndpointReference><a:Address>urn:uuid:camera-123</a:Address></a:EndpointReference>
        <d:Types>dn:NetworkVideoTransmitter</d:Types>
        <d:Scopes>onvif://www.onvif.org/name/Camera_Entrada onvif://www.onvif.org/hardware/Modelo_X</d:Scopes>
        <d:XAddrs>http://192.168.1.50/onvif/device_service</d:XAddrs>
      </d:ProbeMatch></d:ProbeMatches></s:Body>
    </s:Envelope>`;

    const [camera] = analisarMensagemDiscovery(xml, '192.168.1.50');
    assert.equal(camera.endpoint, 'urn:uuid:camera-123');
    assert.equal(camera.deviceUrl, 'http://192.168.1.50/onvif/device_service');
    assert.equal(camera.ip, '192.168.1.50');
    assert.equal(camera.nome, 'Camera_Entrada');
    assert.equal(camera.hardware, 'Modelo_X');
});

test('decompõe URL RTSP retornada pelo perfil ONVIF', () => {
    assert.deepEqual(decomporRtsp('rtsp://192.168.1.50:8554/Streaming/Channels/101?foo=1', '192.168.1.50'), {
        host: '192.168.1.50', porta: 8554, caminho: '/Streaming/Channels/101?foo=1', protocolo: 'rtsp'
    });
});

test('substitui host inválido da câmera pelo IP descoberto', () => {
    assert.equal(decomporRtsp('rtsp://0.0.0.0/live', '10.0.0.20').host, '10.0.0.20');
});

test('escapa valores inseridos em mensagens SOAP', () => {
    assert.equal(escaparXml('<admin&"'), '&lt;admin&amp;&quot;');
});

test('consulta informações, perfis e URL RTSP de um dispositivo ONVIF', async t => {
    const servidor = http.createServer(async (req, res) => {
        const partes = [];
        for await (const parte of req) partes.push(parte);
        const corpo = Buffer.concat(partes).toString('utf8');
        const porta = servidor.address().port;
        let resposta;

        if (corpo.includes('GetSystemDateAndTime')) {
            resposta = '<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>12</tt:Hour><tt:Minute>0</tt:Minute><tt:Second>0</tt:Second></tt:Time><tt:Date><tt:Year>2026</tt:Year><tt:Month>9</tt:Month><tt:Day>13</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>';
        } else if (corpo.includes('GetDeviceInformation')) {
            resposta = '<tds:GetDeviceInformationResponse><tds:Manufacturer>OpenAI Cam</tds:Manufacturer><tds:Model>Modelo Teste</tds:Model><tds:FirmwareVersion>1.2.3</tds:FirmwareVersion><tds:SerialNumber>ABC123</tds:SerialNumber></tds:GetDeviceInformationResponse>';
        } else if (corpo.includes('GetCapabilities')) {
            resposta = `<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>http://127.0.0.1:${porta}/onvif/media</tt:XAddr></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>`;
        } else if (corpo.includes('GetProfiles')) {
            resposta = '<trt:GetProfilesResponse><trt:Profiles token="main"><tt:Name>Principal</tt:Name><tt:VideoEncoderConfiguration><tt:Encoding>H264</tt:Encoding><tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution><tt:RateControl><tt:FrameRateLimit>30</tt:FrameRateLimit></tt:RateControl></tt:VideoEncoderConfiguration></trt:Profiles></trt:GetProfilesResponse>';
        } else {
            resposta = '<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://127.0.0.1:8554/live/main</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse>';
        }

        res.writeHead(200, { 'Content-Type': 'application/soap+xml' });
        res.end(`<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema"><s:Body>${resposta}</s:Body></s:Envelope>`);
    });

    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    t.after(() => servidor.close());
    const porta = servidor.address().port;
    const resultado = await inspecionarOnvif({
        deviceUrl: `http://127.0.0.1:${porta}/onvif/device_service`,
        ip: '192.168.1.50', nome: 'Teste', hardware: ''
    }, 'admin', 'senha');

    assert.equal(resultado.fabricante, 'OpenAI Cam');
    assert.equal(resultado.modelo, 'Modelo Teste');
    assert.equal(resultado.perfis[0].token, 'main');
    assert.equal(resultado.perfis[0].codec, 'H264');
    assert.deepEqual(resultado.perfis[0].stream, {
        host: '192.168.1.50', porta: 8554, caminho: '/live/main', protocolo: 'rtsp'
    });
});
