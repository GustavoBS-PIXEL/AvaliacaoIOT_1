// --- BANCO DE DADOS SIMULADO (Local Storage) ---
let grupos = JSON.parse(localStorage.getItem('grupos')) || ['Geral'];
let cameras = JSON.parse(localStorage.getItem('cameras')) || [];

// Instância do Modal de Câmera (Para abrir via JS)
let modalCameraObj;

document.addEventListener('DOMContentLoaded', function() {
    modalCameraObj = new bootstrap.Modal(document.getElementById('modalCamera'));
    
    configurarEventosGerais();
    atualizarInterface();
});

// --- FUNÇÕES DE RENDERIZAÇÃO (Desenhar na tela) ---

function atualizarInterface() {
    salvarDados();
    renderizarGruposNoModal();
    renderizarOpcoesDeGrupoNoFormulario();
    renderizarAbasECameras();
    verificarEstadoVazio();
}

function verificarEstadoVazio() {
    const divVazio = document.getElementById('estadoVazio');
    const areaTabs = document.getElementById('grupoTabs');
    const areaContent = document.getElementById('grupoTabsContent');

    if (cameras.length === 0) {
        divVazio.classList.remove('d-none');
        areaTabs.classList.add('d-none');
        areaContent.classList.add('d-none');
    } else {
        divVazio.classList.add('d-none');
        areaTabs.classList.remove('d-none');
        areaContent.classList.remove('d-none');
    }
}

function renderizarAbasECameras() {
    const tabsContainer = document.getElementById('grupoTabs');
    const contentContainer = document.getElementById('grupoTabsContent');
    
    tabsContainer.innerHTML = '';
    contentContainer.innerHTML = '';

    // Descobre quais grupos realmente têm câmeras cadastradas
    let gruposAtivos = grupos.filter(grupo => cameras.some(c => c.grupo === grupo));
    
    // Se não tiver câmera em nenhum grupo, para por aqui
    if (gruposAtivos.length === 0) return;

    gruposAtivos.forEach((grupo, index) => {
        let idSeguro = grupo.replace(/[^a-zA-Z0-9]/g, ''); // Tira espaços e acentos para o HTML ID
        let ativo = index === 0 ? 'active' : ''; // Primeira aba fica ativa
        
        // 1. Cria a Aba (Tab)
        tabsContainer.innerHTML += `
            <li class="nav-item" role="presentation">
                <button class="nav-link ${ativo}" id="tab-${idSeguro}" data-bs-toggle="tab" data-bs-target="#content-${idSeguro}" type="button">
                    ${grupo}
                </button>
            </li>
        `;

        // 2. Filtra as câmeras deste grupo
        let camerasDoGrupo = cameras.filter(c => c.grupo === grupo);
        
// 3. Monta o HTML das Câmeras (Os Cards)
        let cardsHtml = camerasDoGrupo.map(cam => {
            let authStr = cam.requerAuth ? `${cam.usuario}:${cam.senha}@` : '';
            let rtspLink = `rtsp://${authStr}${cam.ip}:${cam.porta}/ch0_0.h264`;

            // --- LÓGICA DAS CORES DO STATUS ---
            let corBadge = 'bg-secondary';
            let status = cam.status || 'Online';
            
            if (status === 'Online') corBadge = 'bg-success';
            else if (status === 'Conectando...') corBadge = 'bg-warning text-dark';
            else if (status === 'Offline') corBadge = 'bg-danger';
            else if (status === 'Falha no Login') corBadge = 'bg-danger text-white border border-dark';

            return `
            <div class="col">
                <div class="card h-100 shadow-sm border-0">
                    
                    <div class="camera-placeholder d-flex align-items-center justify-content-center text-secondary rounded-top">
                        <!-- Menu 3 pontos -->
                        <div class="dropdown camera-menu-overlay">
                            <button class="btn btn-sm rounded-circle shadow-sm" type="button" data-bs-toggle="dropdown">
                                <i class="bi bi-three-dots-vertical"></i>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end shadow">
                                <li><a class="dropdown-item" href="#" onclick="editarCamera('${cam.id}')"><i class="bi bi-pencil me-2"></i>Editar</a></li>
                                <li><hr class="dropdown-divider"></li>
                                <li><a class="dropdown-item text-danger" href="#" onclick="excluirCamera('${cam.id}')"><i class="bi bi-trash me-2"></i>Excluir</a></li>
                            </ul>
                        </div>
                        
                        <!-- IFRAME MEDIAMTX -->
                        <div style="z-index: 1; width: 100%; height: 100%;">
                            <iframe 
                                src="http://localhost:8889/cam?url=${encodeURIComponent(rtspLink)}" 
                                scrolling="no" 
                                style="width: 100%; height: 100%; border: none; overflow: hidden; background-color: #1a1a1a;">
                            </iframe>
                        </div>
                    </div>

                    <div class="card-body p-3 bg-white">
                        <h6 class="card-title mb-2 fw-bold d-flex justify-content-between align-items-center">
                            ${cam.nome}
                            <span class="badge ${corBadge}" style="font-size: 0.75rem;">${status}</span>
                        </h6>
                        <small class="text-muted"><i class="bi bi-router me-1"></i>${cam.ip}</small>
                    </div>

                    <!-- NOVO: RODAPÉ DE DIAGNÓSTICO DE ERROS -->
                    <div class="card-footer bg-light p-2 border-top-0">
                        <a class="text-decoration-none text-muted d-block text-center" style="font-size: 0.8rem; cursor: pointer;" data-bs-toggle="collapse" href="#collapseErro${cam.id}">
                            <i class="bi bi-question-circle me-1"></i>A imagem não carregou?
                        </a>
                        <div class="collapse mt-2" id="collapseErro${cam.id}">
                            <div class="alert alert-secondary mb-0 p-2 border-0 shadow-sm" style="font-size: 0.75rem;">
                                <strong>Diagnóstico Automático:</strong><br>
                                <ul class="mb-0 ps-3 mt-1">
                                    <li><span class="text-danger fw-bold">stream not found:</span> O IP está incorreto, a câmera está fora da tomada ou não usa a porta 554.</li>
                                    <li><span class="text-danger fw-bold">unauthorized:</span> Falha de login. Verifique se o usuário/senha estão corretos em "Editar".</li>
                                    <li><span class="text-danger fw-bold">unsupported codec:</span> Incompatibilidade de vídeo. Altere a câmera do formato H.265 para H.264 no aplicativo.</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                </div>
            </div>`;
        }).join('');

        // 4. Cria o container do conteúdo da Aba
        contentContainer.innerHTML += `
            <div class="tab-pane fade show ${ativo}" id="content-${idSeguro}">
                <div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4 pt-3">
                    ${cardsHtml}
                </div>
            </div>
        `;
    });
}

function renderizarGruposNoModal() {
    const lista = document.getElementById('listaGruposModal');
    lista.innerHTML = grupos.map((grupo, index) => {
        // Impede excluir o grupo "Geral" para sempre ter um grupo base
        let btnExcluir = grupo !== 'Geral' ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="excluirGrupo(${index})"><i class="bi bi-trash"></i></button>` : '';
        return `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                ${grupo}
                ${btnExcluir}
            </li>
        `;
    }).join('');
}

function renderizarOpcoesDeGrupoNoFormulario() {
    const select = document.getElementById('selectGrupo');
    select.innerHTML = grupos.map(grupo => `<option value="${grupo}">${grupo}</option>`).join('');
}

// --- LÓGICA DE NEGÓCIO (Adicionar, Editar, Excluir) ---

function configurarEventosGerais() {
    // Alternar campos de autenticação
    document.getElementById('checkAutenticacao').addEventListener('change', function() {
        const containerAuth = document.getElementById('camposAutenticacao');
        const inputUser = document.getElementById('inputUser');
        const inputPass = document.getElementById('inputPass');

        if (this.checked) {
            containerAuth.classList.remove('d-none');
            inputUser.required = true;
            inputPass.required = true;
        } else {
            containerAuth.classList.add('d-none');
            inputUser.required = false;
            inputPass.required = false;
        }
    });

    // Salvar nova câmera ou edição
    document.getElementById('formCamera').addEventListener('submit', function(e) {
        e.preventDefault();
        
        const idAtual = document.getElementById('cameraId').value;
        const dadosCamera = {
            id: idAtual || Date.now().toString(), // Gera um ID único se for nova
            nome: document.getElementById('inputNome').value,
            status: document.getElementById('selectStatus').value,
            grupo: document.getElementById('selectGrupo').value,
            ip: document.getElementById('inputIp').value,
            porta: document.getElementById('inputPorta').value,
            requerAuth: document.getElementById('checkAutenticacao').checked,
            usuario: document.getElementById('inputUser').value,
            senha: document.getElementById('inputPass').value
        };

        if (idAtual) {
            // Edita existente
            const index = cameras.findIndex(c => c.id === idAtual);
            cameras[index] = dadosCamera;
        } else {
            // Adiciona nova
            cameras.push(dadosCamera);
        }

        modalCameraObj.hide();
        atualizarInterface();
    });

    // Adicionar Novo Grupo
    document.getElementById('formNovoGrupo').addEventListener('submit', function(e) {
        e.preventDefault();
        const input = document.getElementById('inputNovoGrupo');
        const novoGrupo = input.value.trim();
        
        if (novoGrupo && !grupos.includes(novoGrupo)) {
            grupos.push(novoGrupo);
            input.value = '';
            atualizarInterface();
        }
    });
}

function abrirModalCamera() {
    document.getElementById('formCamera').reset();
    document.getElementById('cameraId').value = '';
    document.getElementById('tituloModalCamera').innerText = 'Novo Dispositivo de Vídeo';
    document.getElementById('selectStatus').value = 'Online';
    
    // Força o checkbox de senha a desmarcar/esconder
    document.getElementById('checkAutenticacao').checked = false;
    document.getElementById('checkAutenticacao').dispatchEvent(new Event('change'));
    
    modalCameraObj.show();
}

function editarCamera(id) {
    const cam = cameras.find(c => c.id === id);
    if (!cam) return;

    document.getElementById('tituloModalCamera').innerText = 'Editar Dispositivo';
    document.getElementById('cameraId').value = cam.id;
    document.getElementById('inputNome').value = cam.nome;
    document.getElementById('selectStatus').value = cam.status || 'Online';
    document.getElementById('selectGrupo').value = cam.grupo;
    document.getElementById('inputIp').value = cam.ip;
    document.getElementById('inputPorta').value = cam.porta;
    
    const checkAuth = document.getElementById('checkAutenticacao');
    checkAuth.checked = cam.requerAuth;
    checkAuth.dispatchEvent(new Event('change')); // Dispara o evento visual

    if (cam.requerAuth) {
        document.getElementById('inputUser').value = cam.usuario;
        document.getElementById('inputPass').value = cam.senha;
    }

    modalCameraObj.show();
}

function excluirCamera(id) {
    if (confirm('Tem certeza que deseja excluir esta câmera?')) {
        cameras = cameras.filter(c => c.id !== id);
        atualizarInterface();
    }
}

function excluirGrupo(index) {
    const grupoAExcluir = grupos[index];
    
    // Verifica se tem câmeras presas neste grupo
    if (cameras.some(c => c.grupo === grupoAExcluir)) {
        alert('Você não pode excluir um grupo que possui câmeras. Edite ou exclua as câmeras primeiro.');
        return;
    }

    if (confirm(`Deseja excluir o grupo "${grupoAExcluir}"?`)) {
        grupos.splice(index, 1);
        atualizarInterface();
    }
}

function salvarDados() {
    localStorage.setItem('grupos', JSON.stringify(grupos));
    localStorage.setItem('cameras', JSON.stringify(cameras));
}