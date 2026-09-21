let grupos = ['Geral'];
let cameras = [];
let visualizacoes = [];
let mediaServerDisponivel = false;
let modalCameraObj;
let modalOnvifObj;
let modalVisualizacoesObj;
let toastObj;
let dispositivoOnvifAtual = null;
let sessaoOnvifAtual = null;
let csrfToken = '';
let usuarioAtual = null;
let intervaloAtualizacao = null;
let visualizacaoEmExibicao = false;

document.addEventListener('DOMContentLoaded', async () => {
    modalCameraObj = new bootstrap.Modal(document.getElementById('modalCamera'));
    modalOnvifObj = new bootstrap.Modal(document.getElementById('modalOnvif'));
    modalVisualizacoesObj = new bootstrap.Modal(document.getElementById('modalVisualizacoes'));
    toastObj = new bootstrap.Toast(document.getElementById('appToast'));
    configurarEventos();
    configurarAutenticacao();
    await verificarSessao();
});

async function api(url, opcoes = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opcoes.headers || {}) };
    if (csrfToken && !['GET', 'HEAD'].includes(String(opcoes.method || 'GET').toUpperCase())) headers['X-CSRF-Token'] = csrfToken;
    const resposta = await fetch(url, {
        credentials: 'same-origin',
        ...opcoes,
        headers
    });

    const corpo = await resposta.json().catch(() => ({}));
    if (resposta.status === 401 && url !== '/api/auth/login' && url !== '/api/auth/register') mostrarAutenticacao();
    if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível concluir a operação.');
    return corpo;
}

async function verificarSessao() {
    try {
        const dados = await api('/api/auth/me');
        csrfToken = dados.csrfToken;
        usuarioAtual = dados.usuario;
        mostrarAplicacao();
        await carregarDados();
        intervaloAtualizacao = window.setInterval(() => carregarDados({ silencioso: true }), 10000);
    } catch {
        mostrarAutenticacao();
    }
}

function configurarAutenticacao() {
    document.getElementById('formLogin').addEventListener('submit', entrar);
    document.getElementById('formCadastro').addEventListener('submit', cadastrar);
    document.getElementById('btnAlternarAuth').addEventListener('click', alternarTelaAuth);
    document.getElementById('btnLogout').addEventListener('click', sair);
    document.querySelectorAll('[data-password-target]').forEach(button => button.addEventListener('click', alternarSenhaVisivel));
}

function mostrarAutenticacao() {
    csrfToken = '';
    usuarioAtual = null;
    cameras = [];
    visualizacoes = [];
    fecharModoVisualizacao();
    document.getElementById('grupoTabsContent').replaceChildren();
    if (intervaloAtualizacao) window.clearInterval(intervaloAtualizacao);
    intervaloAtualizacao = null;
    document.getElementById('appView').classList.add('d-none');
    document.getElementById('authView').classList.remove('d-none');
}

function mostrarAplicacao() {
    document.getElementById('authView').classList.add('d-none');
    document.getElementById('appView').classList.remove('d-none');
    const nome = usuarioAtual?.nome || 'Usuário';
    document.getElementById('userName').textContent = nome;
    document.getElementById('userEmail').textContent = usuarioAtual?.email || '';
    document.getElementById('userInitial').textContent = nome.trim().charAt(0).toUpperCase() || 'U';
}

function alternarTelaAuth() {
    const cadastro = document.getElementById('formCadastro').classList.contains('d-none');
    document.getElementById('formCadastro').classList.toggle('d-none', !cadastro);
    document.getElementById('formLogin').classList.toggle('d-none', cadastro);
    document.getElementById('authTitle').textContent = cadastro ? 'Crie sua conta' : 'Entre no seu painel';
    document.getElementById('authSubtitle').textContent = cadastro ? 'Configure seu espaço de monitoramento em poucos passos.' : 'Acompanhe suas câmeras em um único lugar.';
    document.getElementById('authSwitchText').textContent = cadastro ? 'Já possui uma conta?' : 'Ainda não tem uma conta?';
    document.getElementById('btnAlternarAuth').textContent = cadastro ? 'Entrar' : 'Criar conta';
    document.getElementById('authAlert').classList.add('d-none');
}

function alternarSenhaVisivel(evento) {
    const button = evento.currentTarget;
    const input = document.getElementById(button.dataset.passwordTarget);
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    button.innerHTML = `<i class="bi bi-eye${mostrar ? '-slash' : ''}"></i>`;
    button.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
}

function exibirErroAuth(mensagem) {
    const alert = document.getElementById('authAlert');
    alert.textContent = mensagem;
    alert.classList.remove('d-none');
}

async function enviarAuth(form, url, dados) {
    const button = form.querySelector('[type="submit"]');
    const original = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Aguarde';
    document.getElementById('authAlert').classList.add('d-none');
    try {
        const resultado = await api(url, { method: 'POST', body: JSON.stringify(dados) });
        csrfToken = resultado.csrfToken;
        usuarioAtual = resultado.usuario;
        form.reset();
        mostrarAplicacao();
        await carregarDados();
        if (!intervaloAtualizacao) intervaloAtualizacao = window.setInterval(() => carregarDados({ silencioso: true }), 10000);
    } catch (erro) {
        exibirErroAuth(erro.message);
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
}

async function entrar(evento) {
    evento.preventDefault();
    await enviarAuth(evento.currentTarget, '/api/auth/login', {
        email: document.getElementById('loginEmail').value,
        senha: document.getElementById('loginSenha').value
    });
}

async function cadastrar(evento) {
    evento.preventDefault();
    const senha = document.getElementById('cadastroSenha').value;
    if (senha !== document.getElementById('cadastroConfirmarSenha').value) {
        exibirErroAuth('As senhas informadas não coincidem.');
        return;
    }
    await enviarAuth(evento.currentTarget, '/api/auth/register', {
        nome: document.getElementById('cadastroNome').value,
        email: document.getElementById('cadastroEmail').value,
        senha
    });
}

async function sair() {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch { /* encerra localmente mesmo se a rede falhar */ }
    mostrarAutenticacao();
}

async function carregarDados({ silencioso = false } = {}) {
    if (obterElementoTelaCheia() || visualizacaoEmExibicao) return;
    try {
        const dados = await api('/api/bootstrap');
        grupos = dados.grupos;
        cameras = dados.cameras;
        visualizacoes = dados.visualizacoes || [];
        mediaServerDisponivel = dados.mediaServerDisponivel;
        csrfToken = dados.csrfToken || csrfToken;
        usuarioAtual = dados.usuario || usuarioAtual;
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
    document.getElementById('totalCameras').textContent = String(cameras.length);
    document.getElementById('camerasOnline').textContent = String(cameras.filter(camera => camera.status === 'online').length);
    document.getElementById('totalGrupos').textContent = String(grupos.length);
}

function atualizarSaudeServidor(disponivel, textoPersonalizado = '') {
    const badge = document.getElementById('statusServidor');
    badge.className = `server-status ${disponivel ? 'is-online' : 'is-offline'}`;
    badge.querySelector('.status-label').textContent = textoPersonalizado || (disponivel ? 'Vídeo ativo' : 'Vídeo indisponível');
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
        grade.className = 'row row-cols-1 row-cols-md-2 row-cols-xl-3 row-cols-xxl-4 g-4 pt-3';

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
    const podeReproduzir = ['online', 'standby'].includes(camera.status);
    const playerUrl = `http://${window.location.hostname}:8889/${encodeURIComponent(camera.streamPath)}?controls=true&muted=true&autoplay=true`;
    const visualizacao = !podeReproduzir
        ? markupCameraIndisponivel(status.mensagem)
        : tipoFonte === 'mjpeg'
            ? `<img class="mjpeg-stream" src="/api/cameras/${encodeURIComponent(camera.id)}/mjpeg" alt="Transmissão MJPEG ao vivo">`
            : `<iframe src="${playerUrl}" title="Transmissão ao vivo" allow="autoplay; fullscreen; picture-in-picture" scrolling="no"></iframe>`;
    const acionadorTelaCheia = podeReproduzir
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
                <div class="text-muted small mt-1"><i class="bi bi-diagram-3 me-1"></i><span class="modo-camera"></span></div>
            </div>
        </article>`;

    coluna.querySelector('.nome-camera').textContent = camera.nome;
    coluna.querySelector('.endereco-camera').textContent = `${camera.host}:${camera.porta}`;
    coluna.querySelector('.caminho-camera').textContent = camera.caminho;
    coluna.querySelector('.modo-camera').textContent = camera.modoConexao === 'cloud' ? 'Saída em nuvem' : 'Gateway local · sob demanda';
    coluna.querySelector('.acao-editar').addEventListener('click', () => editarCamera(camera.id));
    coluna.querySelector('.acao-sincronizar').addEventListener('click', () => sincronizarCamera(camera.id));
    coluna.querySelector('.acao-excluir').addEventListener('click', () => excluirCamera(camera.id));
    configurarFalhaDeImagem(coluna.querySelector('.camera-player'));
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

function obterElementoTelaCheia() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function prepararModalVisualizacoes() {
    renderizarListaVisualizacoes();
    limparEditorVisualizacao();
}

function renderizarListaVisualizacoes() {
    const lista = document.getElementById('listaVisualizacoes');
    const estadoVazio = document.getElementById('estadoVisualizacoesVazio');
    const idEmEdicao = document.getElementById('visualizacaoId').value;
    lista.replaceChildren();
    estadoVazio.classList.toggle('d-none', visualizacoes.length > 0);

    visualizacoes.forEach(visualizacao => {
        const item = document.createElement('article');
        item.className = `view-preset-item${visualizacao.id === idEmEdicao ? ' is-editing' : ''}`;

        const nome = document.createElement('strong');
        nome.textContent = visualizacao.nome;
        const resumo = document.createElement('small');
        const partes = [];
        if (visualizacao.grupos.length) partes.push(`${visualizacao.grupos.length} ${visualizacao.grupos.length === 1 ? 'grupo' : 'grupos'}`);
        if (visualizacao.cameraIds.length) partes.push(`${visualizacao.cameraIds.length} ${visualizacao.cameraIds.length === 1 ? 'câmera específica' : 'câmeras específicas'}`);
        resumo.textContent = partes.join(' + ') || 'Sem seleção';

        const acoes = document.createElement('div');
        acoes.className = 'view-preset-actions';
        const abrir = document.createElement('button');
        abrir.type = 'button';
        abrir.className = 'btn btn-sm btn-primary';
        abrir.innerHTML = '<i class="bi bi-play-fill me-1"></i>Abrir';
        abrir.addEventListener('click', () => abrirVisualizacao(visualizacao.id));
        const editar = document.createElement('button');
        editar.type = 'button';
        editar.className = 'btn btn-sm btn-light border';
        editar.innerHTML = '<i class="bi bi-pencil"></i>';
        editar.setAttribute('aria-label', `Editar ${visualizacao.nome}`);
        editar.addEventListener('click', () => editarVisualizacao(visualizacao.id));
        const excluir = document.createElement('button');
        excluir.type = 'button';
        excluir.className = 'btn btn-sm btn-light border text-danger';
        excluir.innerHTML = '<i class="bi bi-trash"></i>';
        excluir.setAttribute('aria-label', `Excluir ${visualizacao.nome}`);
        excluir.addEventListener('click', () => excluirVisualizacao(visualizacao.id));
        acoes.append(abrir, editar, excluir);
        item.append(nome, resumo, acoes);
        lista.appendChild(item);
    });
}

function criarOpcaoVisualizacao({ tipo, valor, titulo, detalhe, marcada }) {
    const label = document.createElement('label');
    label.className = 'selection-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = `form-check-input ${tipo}`;
    input.value = valor;
    input.checked = marcada;
    const texto = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = titulo;
    const small = document.createElement('small');
    small.textContent = detalhe;
    texto.append(strong, small);
    label.append(input, texto);
    return label;
}

function renderizarOpcoesVisualizacao(visualizacao = { grupos: [], cameraIds: [] }) {
    const gruposContainer = document.getElementById('opcoesGruposVisualizacao');
    gruposContainer.replaceChildren(...grupos.map(grupo => criarOpcaoVisualizacao({
        tipo: 'grupo-visualizacao',
        valor: grupo,
        titulo: grupo,
        detalhe: `${cameras.filter(camera => camera.grupo === grupo).length} câmera(s)`,
        marcada: visualizacao.grupos.includes(grupo)
    })));
    document.getElementById('btnSelecionarTodosGrupos').textContent = grupos.length && visualizacao.grupos.length === grupos.length
        ? 'Limpar grupos'
        : 'Selecionar todos';

    const camerasContainer = document.getElementById('opcoesCamerasVisualizacao');
    if (!cameras.length) {
        const vazio = document.createElement('div');
        vazio.className = 'selection-empty';
        vazio.textContent = 'Cadastre uma câmera para selecioná-la individualmente.';
        camerasContainer.replaceChildren(vazio);
        return;
    }
    camerasContainer.replaceChildren(...cameras.map(camera => criarOpcaoVisualizacao({
        tipo: 'camera-visualizacao',
        valor: camera.id,
        titulo: camera.nome,
        detalhe: camera.grupo,
        marcada: visualizacao.cameraIds.includes(camera.id)
    })));
}

function limparEditorVisualizacao() {
    document.getElementById('formVisualizacao').reset();
    document.getElementById('visualizacaoId').value = '';
    renderizarOpcoesVisualizacao();
    renderizarListaVisualizacoes();
    document.getElementById('visualizacaoNome').focus({ preventScroll: true });
}

function editarVisualizacao(id) {
    const visualizacao = visualizacoes.find(item => item.id === id);
    if (!visualizacao) return;
    document.getElementById('visualizacaoId').value = visualizacao.id;
    document.getElementById('visualizacaoNome').value = visualizacao.nome;
    renderizarOpcoesVisualizacao(visualizacao);
    renderizarListaVisualizacoes();
    document.getElementById('visualizacaoNome').focus({ preventScroll: true });
}

function alternarTodosGruposVisualizacao() {
    const inputs = [...document.querySelectorAll('#opcoesGruposVisualizacao input')];
    const selecionar = inputs.some(input => !input.checked);
    inputs.forEach(input => { input.checked = selecionar; });
    document.getElementById('btnSelecionarTodosGrupos').textContent = selecionar ? 'Limpar grupos' : 'Selecionar todos';
}

async function salvarVisualizacao(evento) {
    evento.preventDefault();
    const id = document.getElementById('visualizacaoId').value;
    const dados = {
        nome: document.getElementById('visualizacaoNome').value.trim(),
        grupos: [...document.querySelectorAll('.grupo-visualizacao:checked')].map(input => input.value),
        cameraIds: [...document.querySelectorAll('.camera-visualizacao:checked')].map(input => input.value)
    };
    const botao = evento.currentTarget.querySelector('[type="submit"]');
    botao.disabled = true;
    try {
        const resultado = await api(id ? `/api/visualizacoes/${encodeURIComponent(id)}` : '/api/visualizacoes', {
            method: id ? 'PUT' : 'POST',
            body: JSON.stringify(dados)
        });
        await carregarDados({ silencioso: true });
        renderizarListaVisualizacoes();
        editarVisualizacao(resultado.visualizacao.id);
        notificar(resultado.mensagem, 'success');
    } catch (erro) {
        notificar(erro.message, 'danger');
    } finally {
        botao.disabled = false;
    }
}

async function excluirVisualizacao(id) {
    const visualizacao = visualizacoes.find(item => item.id === id);
    if (!visualizacao || !window.confirm(`Deseja excluir a visualização "${visualizacao.nome}"?`)) return;
    try {
        await api(`/api/visualizacoes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await carregarDados({ silencioso: true });
        limparEditorVisualizacao();
        notificar('Visualização excluída.', 'success');
    } catch (erro) {
        notificar(erro.message, 'danger');
    }
}

function camerasDaVisualizacao(visualizacao) {
    const gruposSelecionados = new Set(visualizacao.grupos);
    const camerasSelecionadas = new Set(visualizacao.cameraIds);
    return cameras.filter(camera => gruposSelecionados.has(camera.grupo) || camerasSelecionadas.has(camera.id));
}

function criarTileModoVisualizacao(camera) {
    const tile = document.createElement('article');
    tile.className = 'view-mode-tile';
    const status = obterApresentacaoStatus(camera.status);
    const playerUrl = `http://${window.location.hostname}:8889/${encodeURIComponent(camera.streamPath)}?controls=false&muted=true&autoplay=true`;
    if (!['online', 'standby'].includes(camera.status)) {
        tile.innerHTML = markupCameraIndisponivel(status.mensagem);
    } else if ((camera.tipoFonte || 'rtsp') === 'mjpeg') {
        tile.innerHTML = `<img class="mjpeg-stream" src="/api/cameras/${encodeURIComponent(camera.id)}/mjpeg" alt="Transmissão MJPEG ao vivo">`;
    } else {
        tile.innerHTML = `<iframe src="${playerUrl}" title="Transmissão ao vivo" allow="autoplay; fullscreen; picture-in-picture" scrolling="no"></iframe>`;
    }
    configurarFalhaDeImagem(tile);
    const label = document.createElement('span');
    label.className = 'view-mode-label';
    label.textContent = `${camera.nome} · ${camera.grupo}`;
    tile.appendChild(label);
    return tile;
}

function atualizarDimensoesGradeVisualizacao() {
    if (!visualizacaoEmExibicao) return;
    const grade = document.getElementById('gradeModoVisualizacao');
    const quantidade = grade.querySelectorAll('.view-mode-tile').length;
    if (!quantidade) return;
    const proporcaoTela = window.innerWidth / Math.max(1, window.innerHeight - 56);
    const colunas = Math.max(1, Math.ceil(Math.sqrt(quantidade * proporcaoTela / (16 / 9))));
    const linhas = Math.ceil(quantidade / colunas);
    grade.style.setProperty('--wall-cols', String(colunas));
    grade.style.setProperty('--wall-rows', String(linhas));
}

async function abrirVisualizacao(id) {
    const visualizacao = visualizacoes.find(item => item.id === id);
    if (!visualizacao) return;
    const camerasSelecionadas = camerasDaVisualizacao(visualizacao);
    if (!camerasSelecionadas.length) {
        notificar('Essa visualização não possui câmeras disponíveis.', 'warning');
        return;
    }

    const modo = document.getElementById('modoVisualizacao');
    const grade = document.getElementById('gradeModoVisualizacao');
    document.getElementById('tituloModoVisualizacao').textContent = visualizacao.nome;
    document.getElementById('contadorModoVisualizacao').textContent = `${camerasSelecionadas.length} ${camerasSelecionadas.length === 1 ? 'câmera' : 'câmeras'}`;
    grade.replaceChildren(...camerasSelecionadas.map(criarTileModoVisualizacao));
    modalVisualizacoesObj.hide();
    document.getElementById('grupoTabsContent').replaceChildren();
    modo.classList.remove('d-none');
    visualizacaoEmExibicao = true;
    atualizarDimensoesGradeVisualizacao();

    try {
        const solicitar = modo.requestFullscreen || modo.webkitRequestFullscreen;
        if (!solicitar) throw new Error('Tela cheia não disponível.');
        await solicitar.call(modo);
    } catch {
        notificar('O mosaico foi aberto. O navegador não permitiu ativar a tela cheia automaticamente.', 'warning');
    }
}

function fecharModoVisualizacao() {
    if (!visualizacaoEmExibicao) return;
    visualizacaoEmExibicao = false;
    document.getElementById('modoVisualizacao').classList.add('d-none');
    document.getElementById('gradeModoVisualizacao').replaceChildren();
    renderizarAbasECameras();
}

async function sairModoVisualizacao() {
    if (obterElementoTelaCheia()) {
        const sair = document.exitFullscreen || document.webkitExitFullscreen;
        if (sair) {
            try { await sair.call(document); } catch { fecharModoVisualizacao(); }
            return;
        }
    }
    fecharModoVisualizacao();
}

function tratarMudancaTelaCheia() {
    if (!obterElementoTelaCheia() && visualizacaoEmExibicao) fecharModoVisualizacao();
}

function obterApresentacaoStatus(status) {
    if (status === 'online') return { texto: 'Online', classe: 'text-bg-success', mensagem: '' };
    if (status === 'standby') return { texto: 'Sob demanda', classe: 'text-bg-secondary', mensagem: '' };
    if (status === 'offline') return { texto: 'Offline', classe: 'text-bg-danger', mensagem: 'Câmera não conectada.' };
    return { texto: 'Servidor indisponível', classe: 'text-bg-warning', mensagem: 'Inicie o MediaMTX para visualizar esta câmera.' };
}

function markupCameraIndisponivel(mensagem = 'Câmera não conectada.') {
    return `<div class="camera-offline" role="status">
        <i class="bi bi-camera-video-off" aria-hidden="true"></i>
        <strong>Imagem não disponível</strong>
        <span>${mensagem}</span>
    </div>`;
}

function configurarFalhaDeImagem(container) {
    const imagem = container.querySelector('.mjpeg-stream');
    if (!imagem) return;
    imagem.addEventListener('error', () => {
        container.querySelector('.fullscreen-trigger')?.remove();
        imagem.outerHTML = markupCameraIndisponivel('Não foi possível carregar a transmissão da câmera.');
        const badge = container.closest('.camera-card')?.querySelector('.badge');
        if (badge) {
            badge.className = 'badge text-bg-danger';
            badge.textContent = 'Offline';
        }
    }, { once: true });
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
    document.querySelectorAll('.btnAbrirCamera').forEach(button => button.addEventListener('click', abrirModalCamera));
    document.getElementById('checkAutenticacao').addEventListener('change', alternarAutenticacao);
    document.getElementById('selectTipoFonte').addEventListener('change', () => atualizarTipoFonte(true));
    document.querySelectorAll('input[name="modoConexao"]').forEach(input => input.addEventListener('change', atualizarModoConexao));
    document.getElementById('formCamera').addEventListener('submit', salvarCamera);
    document.getElementById('formNovoGrupo').addEventListener('submit', adicionarGrupo);
    document.getElementById('btnAtualizar').addEventListener('click', () => carregarDados());
    document.getElementById('btnGuiaBuscarOnvif').addEventListener('click', () => {
        const guia = document.getElementById('modalGuiaConexao');
        guia.addEventListener('hidden.bs.modal', () => modalOnvifObj.show(), { once: true });
        bootstrap.Modal.getOrCreateInstance(guia).hide();
    });
    document.getElementById('modalOnvif').addEventListener('show.bs.modal', prepararDescobertaOnvif);
    document.getElementById('btnIniciarBuscaOnvif').addEventListener('click', buscarCamerasOnvif);
    document.getElementById('btnVoltarBuscaOnvif').addEventListener('click', () => mostrarEtapaOnvif('busca'));
    document.getElementById('btnVoltarCredenciaisOnvif').addEventListener('click', () => mostrarEtapaOnvif('credenciais'));
    document.getElementById('formCredenciaisOnvif').addEventListener('submit', inspecionarCameraOnvif);
    document.getElementById('formImportarOnvif').addEventListener('submit', importarCameraOnvif);
    document.getElementById('modalVisualizacoes').addEventListener('show.bs.modal', prepararModalVisualizacoes);
    document.getElementById('btnNovaVisualizacao').addEventListener('click', limparEditorVisualizacao);
    document.getElementById('btnCancelarVisualizacao').addEventListener('click', limparEditorVisualizacao);
    document.getElementById('btnSelecionarTodosGrupos').addEventListener('click', alternarTodosGruposVisualizacao);
    document.getElementById('btnLimparCamerasVisualizacao').addEventListener('click', () => {
        document.querySelectorAll('#opcoesCamerasVisualizacao input').forEach(input => { input.checked = false; });
    });
    document.getElementById('formVisualizacao').addEventListener('submit', salvarVisualizacao);
    document.getElementById('btnSairModoVisualizacao').addEventListener('click', sairModoVisualizacao);
    document.addEventListener('fullscreenchange', tratarMudancaTelaCheia);
    document.addEventListener('webkitfullscreenchange', tratarMudancaTelaCheia);
    window.addEventListener('resize', atualizarDimensoesGradeVisualizacao);
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
    const tipoFonte = document.getElementById('selectTipoFonte').value;
    const mjpeg = tipoFonte === 'mjpeg';
    const hls = tipoFonte === 'hls';
    const porta = document.getElementById('inputPorta');
    const caminho = document.getElementById('inputCaminho');
    const protocolo = document.getElementById('selectProtocolo');
    const protocoloAtual = protocolo.value;

    protocolo.replaceChildren(...(tipoFonte === 'rtsp'
        ? [new Option('RTSP', 'rtsp'), new Option('RTSPS (seguro)', 'rtsps')]
        : [new Option('HTTP', 'http'), new Option('HTTPS (seguro)', 'https')]));
    if ([...protocolo.options].some(option => option.value === protocoloAtual)) protocolo.value = protocoloAtual;

    if (aplicarPadroes) {
        porta.value = mjpeg ? '8080' : (hls ? '443' : '554');
        caminho.value = mjpeg ? '/video' : (hls ? '/live/index.m3u8' : '/ch0_0.h264');
        protocolo.value = hls ? 'https' : (mjpeg ? 'http' : 'rtsp');
    }

    document.getElementById('labelPortaCamera').textContent = `Porta ${tipoFonte.toUpperCase()}`;
    document.getElementById('ajudaCaminho').textContent = mjpeg
        ? 'No IP Webcam, o fluxo MJPEG padrão é /video.'
        : hls
            ? 'Informe o caminho completo da playlist, normalmente terminado em .m3u8.'
            : 'Use o caminho RTSP exato informado pelo fabricante da câmera.';
}

function atualizarModoConexao() {
    const modo = document.querySelector('input[name="modoConexao"]:checked')?.value || 'gateway';
    const nuvem = modo === 'cloud';
    document.getElementById('ajudaModoConexao').textContent = nuvem
        ? 'Use um endereço público que a VPS consiga acessar. Nuvens exclusivas do aplicativo do fabricante não são compatíveis sem uma URL padrão.'
        : 'O servidor/gateway deve estar na mesma rede da câmera. A origem é aberta somente enquanto houver alguém assistindo.';
    document.getElementById('labelHostCamera').textContent = nuvem ? 'Domínio ou IP público' : 'IP ou nome do dispositivo';
    document.getElementById('inputIp').placeholder = nuvem ? 'Ex.: camera.exemplo.com' : 'Ex.: 192.168.0.25';
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
        modoConexao: document.querySelector('input[name="modoConexao"]:checked')?.value || 'gateway',
        protocolo: document.getElementById('selectProtocolo').value,
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
    document.querySelector('input[name="modoConexao"][value="gateway"]').checked = true;
    document.getElementById('selectTipoFonte').value = 'rtsp';
    atualizarTipoFonte(true);
    atualizarModoConexao();
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
    document.getElementById('selectProtocolo').value = camera.protocolo || ((camera.tipoFonte || 'rtsp') === 'rtsp' ? 'rtsp' : 'http');
    const modo = document.querySelector(`input[name="modoConexao"][value="${camera.modoConexao || 'gateway'}"]`);
    if (modo) modo.checked = true;
    atualizarModoConexao();
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
