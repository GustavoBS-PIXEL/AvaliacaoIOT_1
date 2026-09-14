let grupos = ['Geral'];
let cameras = [];
let mediaServerDisponivel = false;
let modalCameraObj;
let modalOnvifObj;
let toastObj;
let dispositivoOnvifAtual = null;
let sessaoOnvifAtual = null;

document.addEventListener('DOMContentLoaded', async () => {
    modalCameraObj = new bootstrap.Modal(document.getElementById('modalCamera'));
    modalOnvifObj = new bootstrap.Modal(document.getElementById('modalOnvif'));
    toastObj = new bootstrap.Toast(document.getElementById('appToast'));
    configurarEventos();
    await carregarDados();
    window.setInterval(() => carregarDados({ silencioso: true }), 10000);
});

async function api(url, opcoes = {}) {
    const resposta = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
        ...opcoes
    });

    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível concluir a operação.');
    return corpo;
}

async function carregarDados({ silencioso = false } = {}) {
    try {
        const dados = await api('/api/bootstrap');
        grupos = dados.grupos;
        cameras = dados.cameras;
        mediaServerDisponivel = dados.mediaServerDisponivel;
        atualizarInterface();
    } catch (erro) {
        atualizarSaudeServidor(false, 'Backend indisponível');
        if (!silencioso) notificar(erro.message, 'danger');
    }
}

function atualizarInterface() {
    renderizarGruposNoModal();
    renderizarOpcoesDeGrupo();
    renderizarAbasECameras();
    verificarEstadoVazio();
    atualizarSaudeServidor(mediaServerDisponivel);
}

function atualizarSaudeServidor(disponivel, textoPersonalizado = '') {
    const badge = document.getElementById('statusServidor');
    badge.className = `badge rounded-pill ${disponivel ? 'text-bg-success' : 'text-bg-warning'}`;
    badge.textContent = textoPersonalizado || (disponivel ? 'Servidor de vídeo ativo' : 'Servidor de vídeo indisponível');
}

function verificarEstadoVazio() {
    const vazio = cameras.length === 0;
    document.getElementById('estadoVazio').classList.toggle('d-none', !vazio);
    document.getElementById('grupoTabs').classList.toggle('d-none', vazio);
    document.getElementById('grupoTabsContent').classList.toggle('d-none', vazio);
}

function renderizarAbasECameras() {
    const tabsContainer = document.getElementById('grupoTabs');
    const contentContainer = document.getElementById('grupoTabsContent');
    const grupoAtivoAnterior = tabsContainer.querySelector('.nav-link.active')?.dataset.grupo;
    const gruposAtivos = grupos.filter(grupo => cameras.some(camera => camera.grupo === grupo));

    tabsContainer.replaceChildren();
    contentContainer.replaceChildren();

    gruposAtivos.forEach((grupo, indice) => {
        const ativo = grupo === grupoAtivoAnterior || (!grupoAtivoAnterior && indice === 0);
        const idSeguro = `grupo-${indice}`;

        const item = document.createElement('li');
        item.className = 'nav-item';
        item.innerHTML = `<button class="nav-link ${ativo ? 'active' : ''}" data-bs-toggle="tab" data-bs-target="#${idSeguro}" type="button"></button>`;
        item.querySelector('button').textContent = grupo;
        item.querySelector('button').dataset.grupo = grupo;
        tabsContainer.appendChild(item);

        const painel = document.createElement('div');
        painel.className = `tab-pane fade ${ativo ? 'show active' : ''}`;
        painel.id = idSeguro;
        const grade = document.createElement('div');
        grade.className = 'row row-cols-1 row-cols-md-2 row-cols-xl-3 g-4 pt-3';

        cameras.filter(camera => camera.grupo === grupo).forEach(camera => {
            grade.appendChild(criarCardCamera(camera));
        });

        painel.appendChild(grade);
        contentContainer.appendChild(painel);
    });
}

function criarCardCamera(camera) {
    const coluna = document.createElement('div');
    coluna.className = 'col';

    const status = obterApresentacaoStatus(camera.status);
    const tipoFonte = camera.tipoFonte || 'rtsp';
    const playerUrl = `http://${window.location.hostname}:8889/${encodeURIComponent(camera.streamPath)}?controls=true&muted=true&autoplay=true`;
    const visualizacao = tipoFonte === 'mjpeg'
        ? `<img class="mjpeg-stream" src="/api/cameras/${encodeURIComponent(camera.id)}/mjpeg" alt="Transmissão MJPEG ao vivo">`
        : camera.status !== 'servidor-indisponivel'
            ? `<iframe src="${playerUrl}" title="Transmissão ao vivo" allow="autoplay; fullscreen; picture-in-picture" scrolling="no"></iframe>`
            : `<div class="camera-offline"><i class="bi bi-camera-video-off"></i><span>${status.mensagem}</span></div>`;
    const acionadorTelaCheia = camera.status === 'online'
        ? `<button class="fullscreen-trigger" type="button" aria-label="Abrir câmera em tela cheia">
                <span><i class="bi bi-arrows-fullscreen me-1"></i>Abrir em tela cheia</span>
           </button>`
        : '';

    coluna.innerHTML = `
        <article class="card h-100 shadow-sm border-0 camera-card">
            <div class="camera-player rounded-top">
                <div class="dropdown camera-menu-overlay">
                    <button class="btn btn-sm rounded-circle shadow-sm" type="button" data-bs-toggle="dropdown" aria-label="Opções da câmera">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end shadow">
                        <li><button class="dropdown-item acao-editar"><i class="bi bi-pencil me-2"></i>Editar</button></li>
                        <li><button class="dropdown-item acao-sincronizar"><i class="bi bi-arrow-repeat me-2"></i>Reconectar</button></li>
                        <li><hr class="dropdown-divider"></li>
                        <li><button class="dropdown-item text-danger acao-excluir"><i class="bi bi-trash me-2"></i>Excluir</button></li>
                    </ul>
                </div>
                ${acionadorTelaCheia}
                ${visualizacao}
            </div>
            <div class="card-body p-3">
                <div class="d-flex justify-content-between align-items-start gap-2">
                    <h2 class="h6 card-title fw-bold mb-1 nome-camera"></h2>
                    <span class="badge ${status.classe}">${status.texto}</span>
                </div>
                <div class="text-muted small mt-2"><i class="bi bi-router me-1"></i><span class="endereco-camera"></span></div>
                <div class="text-muted small mt-1"><i class="bi bi-broadcast me-1"></i><span class="caminho-camera"></span></div>
            </div>
        </article>`;

    coluna.querySelector('.nome-camera').textContent = camera.nome;
    coluna.querySelector('.endereco-camera').textContent = `${camera.host}:${camera.porta}`;
    coluna.querySelector('.caminho-camera').textContent = camera.caminho;
    coluna.querySelector('.acao-editar').addEventListener('click', () => editarCamera(camera.id));
    coluna.querySelector('.acao-sincronizar').addEventListener('click', () => sincronizarCamera(camera.id));
    coluna.querySelector('.acao-excluir').addEventListener('click', () => excluirCamera(camera.id));
    const botaoTelaCheia = coluna.querySelector('.fullscreen-trigger');
    if (botaoTelaCheia) {
        botaoTelaCheia.setAttribute('aria-label', `Abrir ${camera.nome} em tela cheia`);
        botaoTelaCheia.addEventListener('click', () => abrirEmTelaCheia(coluna.querySelector('.camera-player')));
    }
    return coluna;
}

async function abrirEmTelaCheia(elemento) {
    try {
        const solicitarTelaCheia = elemento.requestFullscreen || elemento.webkitRequestFullscreen;
        if (!solicitarTelaCheia) throw new Error('Seu navegador não oferece suporte ao modo de tela cheia.');
        await solicitarTelaCheia.call(elemento);
    } catch (erro) {
        notificar(erro.message || 'Não foi possível abrir a câmera em tela cheia.', 'warning');
    }
}

function obterApresentacaoStatus(status) {
    if (status === 'online') return { texto: 'Online', classe: 'text-bg-success', mensagem: '' };
    if (status === 'offline') return { texto: 'Offline', classe: 'text-bg-danger', mensagem: 'A fonte RTSP ainda não está respondendo.' };
    return { texto: 'Servidor indisponível', classe: 'text-bg-warning', mensagem: 'Inicie o MediaMTX para visualizar esta câmera.' };
}

function renderizarGruposNoModal() {
    const lista = document.getElementById('listaGruposModal');
    lista.replaceChildren();

    grupos.forEach(grupo => {
        const item = document.createElement('li');
        item.className = 'list-group-item d-flex justify-content-between align-items-center';
        const nome = document.createElement('span');
        nome.textContent = grupo;
        item.appendChild(nome);

        if (grupo !== 'Geral') {
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'btn btn-sm btn-outline-danger';
            botao.innerHTML = '<i class="bi bi-trash"></i>';
            botao.setAttribute('aria-label', `Excluir grupo ${grupo}`);
            botao.addEventListener('click', () => excluirGrupo(grupo));
            item.appendChild(botao);
        }
        lista.appendChild(item);
    });
}

function renderizarOpcoesDeGrupo() {
    const select = document.getElementById('selectGrupo');
    const valorAtual = select.value;
    select.replaceChildren(...grupos.map(grupo => new Option(grupo, grupo)));
    if (grupos.includes(valorAtual)) select.value = valorAtual;

    const selectOnvif = document.getElementById('selectGrupoOnvif');
    const valorOnvif = selectOnvif.value;
    selectOnvif.replaceChildren(...grupos.map(grupo => new Option(grupo, grupo)));
    if (grupos.includes(valorOnvif)) selectOnvif.value = valorOnvif;
}

function configurarEventos() {
    document.getElementById('checkAutenticacao').addEventListener('change', alternarAutenticacao);
    document.getElementById('selectTipoFonte').addEventListener('change', () => atualizarTipoFonte(true));
    document.getElementById('formCamera').addEventListener('submit', salvarCamera);
    document.getElementById('formNovoGrupo').addEventListener('submit', adicionarGrupo);
    document.getElementById('btnAtualizar').addEventListener('click', () => carregarDados());
    document.getElementById('modalOnvif').addEventListener('show.bs.modal', prepararDescobertaOnvif);
    document.getElementById('btnIniciarBuscaOnvif').addEventListener('click', buscarCamerasOnvif);
    document.getElementById('btnVoltarBuscaOnvif').addEventListener('click', () => mostrarEtapaOnvif('busca'));
    document.getElementById('btnVoltarCredenciaisOnvif').addEventListener('click', () => mostrarEtapaOnvif('credenciais'));
    document.getElementById('formCredenciaisOnvif').addEventListener('submit', inspecionarCameraOnvif);
    document.getElementById('formImportarOnvif').addEventListener('submit', importarCameraOnvif);
}

function mostrarEtapaOnvif(etapa) {
    document.getElementById('etapaBuscaOnvif').classList.toggle('d-none', etapa !== 'busca');
    document.getElementById('etapaCredenciaisOnvif').classList.toggle('d-none', etapa !== 'credenciais');
    document.getElementById('etapaPerfisOnvif').classList.toggle('d-none', etapa !== 'perfis');
}

function prepararDescobertaOnvif() {
    dispositivoOnvifAtual = null;
    sessaoOnvifAtual = null;
    document.getElementById('formCredenciaisOnvif').reset();
    document.getElementById('formImportarOnvif').reset();
    document.getElementById('resultadosOnvif').replaceChildren();
    document.getElementById('mensagemBuscaOnvif').textContent = 'Clique em “Iniciar busca” para procurar dispositivos.';
    document.getElementById('mensagemBuscaOnvif').classList.remove('d-none');
    mostrarEtapaOnvif('busca');
}

async function buscarCamerasOnvif() {
    const botao = document.getElementById('btnIniciarBuscaOnvif');
    const carregando = document.getElementById('carregandoOnvif');
    const mensagem = document.getElementById('mensagemBuscaOnvif');
    const resultados = document.getElementById('resultadosOnvif');

    botao.disabled = true;
    carregando.classList.remove('d-none');
    mensagem.classList.add('d-none');
    resultados.replaceChildren();

    try {
        const resposta = await api('/api/onvif/descobrir', { method: 'POST', body: '{}' });
        carregando.classList.add('d-none');
        if (!resposta.dispositivos.length) {
            mensagem.textContent = 'Nenhuma câmera ONVIF respondeu. Verifique a rede, o multicast e se o ONVIF está habilitado.';
            mensagem.classList.remove('d-none');
            return;
        }
        resposta.dispositivos.forEach(dispositivo => resultados.appendChild(criarResultadoOnvif(dispositivo)));
    } catch (erro) {
        carregando.classList.add('d-none');
        mensagem.textContent = erro.message;
        mensagem.classList.remove('d-none');
    } finally {
        botao.disabled = false;
    }
}

function criarResultadoOnvif(dispositivo) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-3 py-3';

    const descricao = document.createElement('span');
    descricao.className = 'd-block text-start';
    const nome = document.createElement('strong');
    nome.className = 'd-block';
    nome.textContent = dispositivo.nome || dispositivo.hardware || 'Câmera ONVIF';
    const detalhes = document.createElement('small');
    detalhes.className = 'text-muted';
    detalhes.textContent = [dispositivo.ip, dispositivo.hardware, dispositivo.localizacao].filter(Boolean).join(' · ');
    descricao.append(nome, detalhes);

    const acao = document.createElement('span');
    acao.className = 'badge text-bg-primary';
    acao.textContent = 'Configurar';
    item.append(descricao, acao);
    item.addEventListener('click', () => selecionarDispositivoOnvif(dispositivo));
    return item;
}

function selecionarDispositivoOnvif(dispositivo) {
    dispositivoOnvifAtual = dispositivo;
    const resumo = document.getElementById('dispositivoSelecionadoOnvif');
    resumo.replaceChildren();
    const titulo = document.createElement('strong');
    titulo.className = 'd-block';
    titulo.textContent = dispositivo.nome || 'Câmera ONVIF';
    const detalhes = document.createElement('span');
    detalhes.className = 'small text-muted';
    detalhes.textContent = [dispositivo.ip, dispositivo.hardware].filter(Boolean).join(' · ');
    resumo.append(titulo, detalhes);
    mostrarEtapaOnvif('credenciais');
    document.getElementById('inputUsuarioOnvif').focus();
}

async function inspecionarCameraOnvif(evento) {
    evento.preventDefault();
    if (!dispositivoOnvifAtual) return;
    const botao = document.getElementById('btnLerPerfisOnvif');
    botao.disabled = true;
    botao.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Consultando...';

    try {
        const resposta = await api('/api/onvif/inspecionar', {
            method: 'POST',
            body: JSON.stringify({
                discoveryId: dispositivoOnvifAtual.id,
                usuario: document.getElementById('inputUsuarioOnvif').value,
                senha: document.getElementById('inputSenhaOnvif').value
            })
        });
        sessaoOnvifAtual = resposta;
        preencherPerfisOnvif(resposta);
        mostrarEtapaOnvif('perfis');
    } catch (erro) {
        notificar(erro.message, 'danger');
    } finally {
        botao.disabled = false;
        botao.innerHTML = '<i class="bi bi-camera-video me-1"></i>Ler perfis de vídeo';
    }
}

function preencherPerfisOnvif(inspecao) {
    const informacoes = document.getElementById('informacoesCameraOnvif');
    informacoes.replaceChildren();
    const titulo = document.createElement('strong');
    titulo.className = 'd-block';
    titulo.textContent = [inspecao.fabricante, inspecao.modelo].filter(Boolean).join(' ') || 'Câmera ONVIF';
    const detalhes = document.createElement('span');
    detalhes.className = 'small text-muted';
    detalhes.textContent = [inspecao.firmware && `Firmware ${inspecao.firmware}`, inspecao.serial && `Série ${inspecao.serial}`].filter(Boolean).join(' · ');
    informacoes.append(titulo, detalhes);

    const select = document.getElementById('selectPerfilOnvif');
    select.replaceChildren();
    inspecao.perfis.filter(perfil => perfil.disponivel).forEach(perfil => {
        const resolucao = perfil.largura && perfil.altura ? `${perfil.largura}×${perfil.altura}` : 'resolução não informada';
        const fps = perfil.fps ? ` · ${perfil.fps} fps` : '';
        select.add(new Option(`${perfil.nome} · ${perfil.codec || 'codec não informado'} · ${resolucao}${fps}`, perfil.token));
    });
    document.getElementById('inputNomeOnvif').value = titulo.textContent;
    document.getElementById('selectGrupoOnvif').replaceChildren(...grupos.map(grupo => new Option(grupo, grupo)));
}

async function importarCameraOnvif(evento) {
    evento.preventDefault();
    if (!sessaoOnvifAtual) return;
    const botao = document.getElementById('btnImportarOnvif');
    botao.disabled = true;
    botao.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Adicionando...';

    try {
        const resultado = await api('/api/onvif/importar', {
            method: 'POST',
            body: JSON.stringify({
                sessionId: sessaoOnvifAtual.sessionId,
                profileToken: document.getElementById('selectPerfilOnvif').value,
                nome: document.getElementById('inputNomeOnvif').value.trim(),
                grupo: document.getElementById('selectGrupoOnvif').value
            })
        });
        modalOnvifObj.hide();
        await carregarDados({ silencioso: true });
        notificar(resultado.aviso || resultado.mensagem, resultado.aviso ? 'warning' : 'success');
    } catch (erro) {
        notificar(erro.message, 'danger');
    } finally {
        botao.disabled = false;
        botao.innerHTML = '<i class="bi bi-plus-circle me-1"></i>Adicionar ao painel';
    }
}

function atualizarTipoFonte(aplicarPadroes) {
    const mjpeg = document.getElementById('selectTipoFonte').value === 'mjpeg';
    const porta = document.getElementById('inputPorta');
    const caminho = document.getElementById('inputCaminho');

    if (aplicarPadroes) {
        porta.value = mjpeg ? '8080' : '554';
        caminho.value = mjpeg ? '/video' : '/ch0_0.h264';
    }

    document.getElementById('ajudaCaminho').textContent = mjpeg
        ? 'No IP Webcam, o fluxo MJPEG padrão é /video.'
        : 'Use o caminho RTSP exato informado pelo fabricante da câmera.';
}

function alternarAutenticacao() {
    const marcada = document.getElementById('checkAutenticacao').checked;
    document.getElementById('camposAutenticacao').classList.toggle('d-none', !marcada);
    document.getElementById('inputUser').required = marcada;
}

async function salvarCamera(evento) {
    evento.preventDefault();
    const id = document.getElementById('cameraId').value;
    const dados = {
        nome: document.getElementById('inputNome').value.trim(),
        grupo: document.getElementById('selectGrupo').value,
        host: document.getElementById('inputIp').value.trim(),
        porta: Number(document.getElementById('inputPorta').value),
        caminho: document.getElementById('inputCaminho').value.trim(),
        tipoFonte: document.getElementById('selectTipoFonte').value,
        requerAuth: document.getElementById('checkAutenticacao').checked,
        usuario: document.getElementById('inputUser').value,
        senha: document.getElementById('inputPass').value
    };

    try {
        const resultado = await api(id ? `/api/cameras/${encodeURIComponent(id)}` : '/api/cameras', {
            method: id ? 'PUT' : 'POST',
            body: JSON.stringify(dados)
        });
        modalCameraObj.hide();
        await carregarDados({ silencioso: true });
        notificar(resultado.aviso || 'Câmera salva e sincronizada.', resultado.aviso ? 'warning' : 'success');
    } catch (erro) {
        notificar(erro.message, 'danger');
    }
}

async function adicionarGrupo(evento) {
    evento.preventDefault();
    const input = document.getElementById('inputNovoGrupo');
    try {
        await api('/api/grupos', { method: 'POST', body: JSON.stringify({ nome: input.value.trim() }) });
        input.value = '';
        await carregarDados({ silencioso: true });
    } catch (erro) {
        notificar(erro.message, 'danger');
    }
}

function abrirModalCamera() {
    document.getElementById('formCamera').reset();
    document.getElementById('cameraId').value = '';
    document.getElementById('tituloModalCamera').textContent = 'Novo dispositivo de vídeo';
    document.getElementById('selectTipoFonte').value = 'mjpeg';
    atualizarTipoFonte(true);
    alternarAutenticacao();
    modalCameraObj.show();
}

function editarCamera(id) {
    const camera = cameras.find(item => item.id === id);
    if (!camera) return;

    document.getElementById('tituloModalCamera').textContent = 'Editar dispositivo';
    document.getElementById('cameraId').value = camera.id;
    document.getElementById('inputNome').value = camera.nome;
    document.getElementById('selectGrupo').value = camera.grupo;
    document.getElementById('inputIp').value = camera.host;
    document.getElementById('inputPorta').value = camera.porta;
    document.getElementById('inputCaminho').value = camera.caminho;
    document.getElementById('selectTipoFonte').value = camera.tipoFonte || 'rtsp';
    atualizarTipoFonte(false);
    document.getElementById('checkAutenticacao').checked = camera.requerAuth;
    document.getElementById('inputUser').value = camera.usuario || '';
    document.getElementById('inputPass').value = '';
    document.getElementById('inputPass').placeholder = camera.possuiSenha ? 'Deixe vazio para manter a senha atual' : '';
    alternarAutenticacao();
    modalCameraObj.show();
}

async function sincronizarCamera(id) {
    try {
        const resultado = await api(`/api/cameras/${encodeURIComponent(id)}/sincronizar`, { method: 'POST' });
        notificar(resultado.mensagem, 'success');
        window.setTimeout(() => carregarDados({ silencioso: true }), 1200);
    } catch (erro) {
        notificar(erro.message, 'danger');
    }
}

async function excluirCamera(id) {
    if (!window.confirm('Tem certeza que deseja excluir esta câmera?')) return;
    try {
        await api(`/api/cameras/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await carregarDados({ silencioso: true });
        notificar('Câmera excluída.', 'success');
    } catch (erro) {
        notificar(erro.message, 'danger');
    }
}

async function excluirGrupo(grupo) {
    if (!window.confirm(`Deseja excluir o grupo "${grupo}"?`)) return;
    try {
        await api(`/api/grupos/${encodeURIComponent(grupo)}`, { method: 'DELETE' });
        await carregarDados({ silencioso: true });
    } catch (erro) {
        notificar(erro.message, 'danger');
    }
}

function notificar(mensagem, tipo = 'primary') {
    const toast = document.getElementById('appToast');
    toast.className = `toast align-items-center text-bg-${tipo} border-0`;
    toast.querySelector('.toast-body').textContent = mensagem;
    toastObj.show();
}

window.abrirModalCamera = abrirModalCamera;
