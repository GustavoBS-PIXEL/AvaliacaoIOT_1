'use strict';

const dgram = require('node:dgram');
const crypto = require('node:crypto');
const os = require('node:os');
const { XMLParser } = require('fast-xml-parser');

const DISCOVERY_ADDRESS = '239.255.255.250';
const DISCOVERY_PORT = 3702;
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true
});

function escaparXml(valor) {
    return String(valor)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function comoLista(valor) {
    if (valor === undefined || valor === null) return [];
    return Array.isArray(valor) ? valor : [valor];
}

function buscarChave(objeto, chave) {
    if (!objeto || typeof objeto !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(objeto, chave)) return objeto[chave];
    for (const valor of Object.values(objeto)) {
        const encontrado = buscarChave(valor, chave);
        if (encontrado !== undefined) return encontrado;
    }
    return undefined;
}

function decodificarEscopo(escopo) {
    try {
        const url = new URL(escopo);
        const partes = url.pathname.split('/').filter(Boolean).map(parte => decodeURIComponent(parte));
        return { bruto: escopo, categoria: partes[0] || '', valor: partes.slice(1).join('/') };
    } catch {
        return { bruto: escopo, categoria: '', valor: escopo };
    }
}

function analisarMensagemDiscovery(xml, enderecoResposta = '') {
    let documento;
    try {
        documento = parser.parse(xml);
    } catch {
        return [];
    }

    const matches = comoLista(buscarChave(documento, 'ProbeMatch'));
    return matches.flatMap(match => {
        const xaddrs = String(match.XAddrs || '').split(/\s+/).filter(Boolean);
        if (!xaddrs.length) return [];
        const escopos = String(match.Scopes || '').split(/\s+/).filter(Boolean).map(decodificarEscopo);
        const endpoint = buscarChave(match.EndpointReference, 'Address') || '';
        const nome = escopos.find(item => item.categoria.toLowerCase() === 'name')?.valor;
        const hardware = escopos.find(item => item.categoria.toLowerCase() === 'hardware')?.valor;
        const localizacao = escopos.find(item => item.categoria.toLowerCase() === 'location')?.valor;
        return [{
            endpoint,
            xaddrs,
            deviceUrl: xaddrs.find(item => item.startsWith('http://')) || xaddrs[0],
            ip: enderecoResposta,
            nome: nome || hardware || `Câmera ${enderecoResposta}`,
            hardware: hardware || '',
            localizacao: localizacao || '',
            tipos: String(match.Types || '').split(/\s+/).filter(Boolean),
            escopos: escopos.map(item => item.bruto)
        }];
    });
}

function mensagemProbe(filtrarCamera = true) {
    const uuid = crypto.randomUUID();
    return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
 xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:${uuid}</w:MessageID>
    <w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body><d:Probe>${filtrarCamera ? '<d:Types>dn:NetworkVideoTransmitter</d:Types>' : ''}</d:Probe></e:Body>
</e:Envelope>`;
}

function descobrirOnvif({ timeoutMs = 4000 } = {}) {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const encontrados = new Map();
        let finalizado = false;

        function concluir(erro) {
            if (finalizado) return;
            finalizado = true;
            socket.close();
            if (erro) reject(erro);
            else resolve([...encontrados.values()]);
        }

        socket.on('message', (mensagem, remoto) => {
            for (const camera of analisarMensagemDiscovery(mensagem.toString('utf8'), remoto.address)) {
                const chave = camera.endpoint || camera.deviceUrl || remoto.address;
                encontrados.set(chave, camera);
            }
        });
        socket.once('error', concluir);
        socket.bind(0, '0.0.0.0', () => {
            socket.setMulticastTTL(2);
            const interfaces = Object.values(os.networkInterfaces()).flat()
                .filter(item => item && item.family === 'IPv4' && !item.internal)
                .map(item => item.address);
            const enderecos = interfaces.length ? interfaces : [null];

            for (const endereco of enderecos) {
                try {
                    if (endereco) socket.setMulticastInterface(endereco);
                    for (const filtrarCamera of [true, false]) {
                        socket.send(Buffer.from(mensagemProbe(filtrarCamera)), DISCOVERY_PORT, DISCOVERY_ADDRESS);
                    }
                } catch {
                    // Continua pelas demais interfaces, útil em máquinas com VPNs/adaptadores virtuais.
                }
            }
        });
        setTimeout(() => concluir(), Math.min(Math.max(timeoutMs, 1000), 10000));
    });
}

function cabecalhoWsSecurity(usuario, senha, deslocamentoMs = 0) {
    if (!usuario) return '';
    const nonce = crypto.randomBytes(16);
    const criado = new Date(Date.now() + deslocamentoMs).toISOString();
    const digest = crypto.createHash('sha1')
        .update(Buffer.concat([nonce, Buffer.from(criado), Buffer.from(senha)]))
        .digest('base64');

    return `<s:Header>
      <wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <wsse:UsernameToken>
          <wsse:Username>${escaparXml(usuario)}</wsse:Username>
          <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>
          <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce>
          <wsu:Created>${criado}</wsu:Created>
        </wsse:UsernameToken>
      </wsse:Security>
    </s:Header>`;
}

function envelopeSoap(conteudo, credenciais = {}) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
 xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
 xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
 xmlns:tr2="http://www.onvif.org/ver20/media/wsdl"
 xmlns:tt="http://www.onvif.org/ver10/schema">
  ${cabecalhoWsSecurity(credenciais.usuario, credenciais.senha, credenciais.deslocamentoMs)}
  <s:Body>${conteudo}</s:Body>
</s:Envelope>`;
}

function analisarDesafioDigest(cabecalho) {
    if (!cabecalho || !/^Digest\s/i.test(cabecalho)) return null;
    const resultado = {};
    const texto = cabecalho.replace(/^Digest\s+/i, '');
    const regex = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
    for (const match of texto.matchAll(regex)) resultado[match[1].toLowerCase()] = match[2] ?? match[3];
    return resultado.realm && resultado.nonce ? resultado : null;
}

function md5(texto) {
    return crypto.createHash('md5').update(texto).digest('hex');
}

function autorizacaoDigest(url, metodo, usuario, senha, desafio) {
    const uri = `${url.pathname}${url.search}`;
    const qop = String(desafio.qop || '').split(',').map(item => item.trim()).find(item => item === 'auth');
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    let ha1 = md5(`${usuario}:${desafio.realm}:${senha}`);
    if (String(desafio.algorithm || '').toLowerCase() === 'md5-sess') ha1 = md5(`${ha1}:${desafio.nonce}:${cnonce}`);
    const ha2 = md5(`${metodo}:${uri}`);
    const resposta = qop
        ? md5(`${ha1}:${desafio.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        : md5(`${ha1}:${desafio.nonce}:${ha2}`);
    const partes = [
        `username="${usuario.replaceAll('"', '\\"')}"`, `realm="${desafio.realm}"`,
        `nonce="${desafio.nonce}"`, `uri="${uri}"`, `response="${resposta}"`
    ];
    if (desafio.algorithm) partes.push(`algorithm=${desafio.algorithm}`);
    if (desafio.opaque) partes.push(`opaque="${desafio.opaque}"`);
    if (qop) partes.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    return `Digest ${partes.join(', ')}`;
}

async function requisicaoSoap(endereco, acao, conteudo, credenciais = {}) {
    const url = new URL(endereco);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('O dispositivo informou um endereço ONVIF inválido.');
    const corpo = envelopeSoap(conteudo, credenciais);

    async function executar(authorization) {
        const headers = {
            'Content-Type': `application/soap+xml; charset=utf-8; action="${acao}"`,
            Accept: 'application/soap+xml, application/xml'
        };
        if (authorization) headers.Authorization = authorization;
        return fetch(url, {
            method: 'POST', body: corpo, headers, redirect: 'manual', signal: AbortSignal.timeout(7000)
        });
    }

    let resposta = await executar();
    if (resposta.status === 401 && credenciais.usuario) {
        const desafio = analisarDesafioDigest(resposta.headers.get('www-authenticate'));
        if (desafio) resposta = await executar(autorizacaoDigest(url, 'POST', credenciais.usuario, credenciais.senha, desafio));
    }

    const texto = await resposta.text();
    if (!resposta.ok) {
        let motivo = '';
        try { motivo = buscarChave(parser.parse(texto), 'Text') || buscarChave(parser.parse(texto), 'Reason') || ''; } catch { /* resposta não XML */ }
        if (resposta.status === 401) throw new Error('Usuário ou senha ONVIF inválidos.');
        throw new Error(`A câmera recusou a solicitação ONVIF (HTTP ${resposta.status})${motivo ? `: ${motivo}` : '.'}`);
    }
    return parser.parse(texto);
}

function extrairDataOnvif(documento) {
    const dataHora = buscarChave(documento, 'UTCDateTime') || buscarChave(documento, 'LocalDateTime');
    if (!dataHora?.Date || !dataHora?.Time) return null;
    const valor = Date.UTC(
        Number(dataHora.Date.Year), Number(dataHora.Date.Month) - 1, Number(dataHora.Date.Day),
        Number(dataHora.Time.Hour), Number(dataHora.Time.Minute), Number(dataHora.Time.Second)
    );
    return Number.isFinite(valor) ? valor : null;
}

async function obterDeslocamentoRelogio(deviceUrl, credenciais) {
    try {
        const documento = await requisicaoSoap(
            deviceUrl,
            'http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime',
            '<tds:GetSystemDateAndTime/>',
            credenciais
        );
        const dataCamera = extrairDataOnvif(documento);
        return dataCamera === null ? 0 : dataCamera - Date.now();
    } catch {
        return 0;
    }
}

function extrairServicoMedia(capacidades, servicos) {
    const media = buscarChave(capacidades, 'Media');
    if (media?.XAddr) return { url: media.XAddr, versao: 1 };

    const respostaServicos = buscarChave(servicos, 'GetServicesResponse') || {};
    const lista = comoLista(respostaServicos.Service);
    const media1 = lista.find(item => String(item.Namespace || '').includes('/ver10/media/wsdl'));
    if (media1?.XAddr) return { url: media1.XAddr, versao: 1 };
    const media2 = lista.find(item => String(item.Namespace || '').includes('/ver20/media/wsdl'));
    if (media2?.XAddr) return { url: media2.XAddr, versao: 2 };
    return null;
}

function descricaoPerfil(perfil, indice) {
    const configuracoes = perfil.Configurations || {};
    const encoder = perfil.VideoEncoderConfiguration || configuracoes.VideoEncoder || configuracoes.VideoEncoderConfiguration || {};
    const resolucao = encoder.Resolution || {};
    const controle = encoder.RateControl || {};
    return {
        token: perfil['@_token'] || perfil['@_Token'] || '',
        nome: perfil.Name || `Perfil ${indice + 1}`,
        codec: encoder.Encoding || '',
        largura: Number(resolucao.Width) || null,
        altura: Number(resolucao.Height) || null,
        fps: Number(controle.FrameRateLimit) || null,
        bitrateKbps: Number(controle.BitrateLimit) || null
    };
}

function decomporRtsp(uri, ipFallback) {
    const url = new URL(uri);
    if (!['rtsp:', 'rtsps:'].includes(url.protocol)) throw new Error('O perfil não forneceu uma URL RTSP compatível.');
    let host = url.hostname;
    if (['0.0.0.0', '127.0.0.1', 'localhost'].includes(host)) host = ipFallback;
    return {
        host,
        porta: Number(url.port) || 554,
        caminho: `${url.pathname || '/'}${url.search}`,
        protocolo: url.protocol.replace(':', '')
    };
}

async function inspecionarOnvif(dispositivo, usuario, senha) {
    const credenciais = { usuario: String(usuario || ''), senha: String(senha || ''), deslocamentoMs: 0 };
    credenciais.deslocamentoMs = await obterDeslocamentoRelogio(dispositivo.deviceUrl, credenciais);

    const [informacoes, capacidades, servicos] = await Promise.all([
        requisicaoSoap(
            dispositivo.deviceUrl,
            'http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation',
            '<tds:GetDeviceInformation/>', credenciais
        ),
        requisicaoSoap(
            dispositivo.deviceUrl,
            'http://www.onvif.org/ver10/device/wsdl/GetCapabilities',
            '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>', credenciais
        ),
        requisicaoSoap(
            dispositivo.deviceUrl,
            'http://www.onvif.org/ver10/device/wsdl/GetServices',
            '<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>', credenciais
        ).catch(() => null)
    ]);

    const info = buscarChave(informacoes, 'GetDeviceInformationResponse') || {};
    const servicoMedia = extrairServicoMedia(capacidades, servicos);
    if (!servicoMedia) throw new Error('A câmera não informou o serviço ONVIF de mídia.');
    const mediaUrl = servicoMedia.url;
    const media2 = servicoMedia.versao === 2;

    const documentoPerfis = await requisicaoSoap(
        mediaUrl,
        media2 ? 'http://www.onvif.org/ver20/media/wsdl/GetProfiles' : 'http://www.onvif.org/ver10/media/wsdl/GetProfiles',
        media2 ? '<tr2:GetProfiles><tr2:Type>All</tr2:Type></tr2:GetProfiles>' : '<trt:GetProfiles/>',
        credenciais
    );
    const perfisBrutos = comoLista(buscarChave(documentoPerfis, 'Profiles'));
    const perfis = [];

    for (const [indice, perfil] of perfisBrutos.entries()) {
        const descricao = descricaoPerfil(perfil, indice);
        if (!descricao.token) continue;
        try {
            const respostaUri = await requisicaoSoap(
                mediaUrl,
                media2 ? 'http://www.onvif.org/ver20/media/wsdl/GetStreamUri' : 'http://www.onvif.org/ver10/media/wsdl/GetStreamUri',
                media2 ? `<tr2:GetStreamUri><tr2:Protocol>RTSP</tr2:Protocol><tr2:ProfileToken>${escaparXml(descricao.token)}</tr2:ProfileToken></tr2:GetStreamUri>` : `<trt:GetStreamUri>
                  <trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup>
                  <trt:ProfileToken>${escaparXml(descricao.token)}</trt:ProfileToken>
                </trt:GetStreamUri>`, credenciais
            );
            const uri = buscarChave(buscarChave(respostaUri, 'MediaUri') || respostaUri, 'Uri');
            if (!uri) throw new Error('URL ausente');
            perfis.push({ ...descricao, stream: decomporRtsp(uri, dispositivo.ip) });
        } catch (erro) {
            perfis.push({ ...descricao, erro: erro.message });
        }
    }

    if (!perfis.some(perfil => perfil.stream)) throw new Error('Nenhum perfil RTSP utilizável foi retornado pela câmera.');
    return {
        fabricante: info.Manufacturer || '',
        modelo: info.Model || dispositivo.hardware || dispositivo.nome,
        firmware: info.FirmwareVersion || '',
        serial: info.SerialNumber || '',
        mediaUrl,
        perfis,
        credenciais
    };
}

module.exports = {
    analisarMensagemDiscovery,
    descobrirOnvif,
    inspecionarOnvif,
    decomporRtsp,
    escaparXml
};
