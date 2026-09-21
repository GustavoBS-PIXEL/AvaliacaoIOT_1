# Sentinela — Painel de Segurança IoT

Aplicação para cadastrar câmeras RTSP, MJPEG e HLS e visualizar as transmissões no navegador. O backend Node.js mantém contas, sessões e dispositivos no MySQL e configura o MediaMTX, que entrega as fontes compatíveis ao navegador por WebRTC.

O sistema aceita dois modos de conexão:

- **Gateway local:** o servidor/gateway fica na rede das câmeras. A fonte é aberta sob demanda e encerrada dez segundos depois que o último espectador sai.
- **Saída em nuvem:** o servidor acessa um endereço público RTSP, RTSPS, HLS ou MJPEG fornecido pela câmera ou pelo fabricante.

Uma câmera que funciona apenas no aplicativo proprietário do fabricante não é automaticamente uma câmera com “saída em nuvem”. Para cadastrá-la nesse modo, o serviço precisa fornecer uma URL de transmissão compatível.

## Executar no Windows

Requisitos: Node.js 20 ou superior, MySQL (o incluído no XAMPP funciona) e acesso à internet durante a instalação inicial.

1. Abra o painel do XAMPP e inicie o **MySQL**.
2. No terminal do projeto, execute:

```powershell
npm run setup
npm start
```

Abra `http://127.0.0.1:3000`. O comando `npm start` inicia tanto o painel quanto o MediaMTX instalado pelo setup.
O `setup` precisa ser executado apenas uma vez; repeti-lo detecta a instalação existente sem tentar substituir o executável em uso.

Na primeira inicialização, o sistema cria automaticamente o banco `painel_seguranca_iot` e suas tabelas. A configuração padrão é compatível com uma instalação local padrão do XAMPP (`root` sem senha). Caso seu MySQL use outras credenciais, defina as variáveis antes de iniciar:

```powershell
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3306'
$env:DB_USER = 'seu_usuario'
$env:DB_PASSWORD = 'sua_senha'
$env:DB_NAME = 'painel_seguranca_iot'
npm start
```

Ao acessar pela primeira vez, use **Criar conta** na tela de login. Cada conta possui seus próprios grupos e câmeras.

Quando uma câmera estiver online, clique sobre a imagem para visualizá-la em tela cheia. Pressione `Esc` para retornar ao painel.

## Modos de visualização

O botão **Modo de visualização** permite criar predefinições como “Geral” ou “Casa + Garagem”. Cada predefinição pode combinar:

- grupos completos, incluindo automaticamente novas câmeras adicionadas depois;
- câmeras específicas de qualquer grupo;
- todos os grupos, para formar um painel geral.

Ao abrir uma predefinição, as transmissões são distribuídas igualmente em um mosaico que ocupa toda a tela. Use **Sair** ou pressione `Esc` para retornar. A atualização periódica do painel é pausada enquanto uma câmera individual estiver em tela cheia, evitando que o navegador encerre esse modo ao reconstruir os cartões.

## Descoberta automática ONVIF

Use **Buscar câmeras** para localizar dispositivos ONVIF na rede local. O backend envia probes WS-Discovery pelas interfaces IPv4 ativas, identifica os dispositivos, autentica usando WS-Security ou HTTP Digest, consulta seus perfis de mídia e importa a URL RTSP selecionada.

Para a descoberta funcionar:

- computador e câmera devem estar na mesma sub-rede;
- ONVIF deve estar habilitado na câmera;
- multicast e UDP `3702` não podem estar bloqueados;
- o roteador não pode usar isolamento de clientes Wi-Fi;
- algumas marcas exigem criar um usuário ONVIF separado.

As credenciais usadas durante a consulta ficam temporariamente apenas na memória. Depois da importação, a senha da câmera é cifrada antes de ser gravada no MySQL.

## Gateway e acesso por VPS

Nesta versão, o próprio processo Node.js + MediaMTX exerce o papel de gateway. Para câmeras com endereço local (`192.168.x.x`, `10.x.x.x` etc.), ele deve ser executado em um computador, NAS ou mini-PC ligado na mesma rede das câmeras.

O MediaMTX recebe a configuração com `sourceOnDemand: true`. Assim, cadastrar uma câmera não mantém o vídeo sendo enviado continuamente. A origem é aberta quando um cartão, uma câmera em tela cheia ou um mosaico está sendo assistido, e é liberada após a saída do último espectador.

Se o painel principal for hospedado em uma VPS, câmeras locais exigem um conector/gateway na instalação do cliente e um canal seguro entre esse gateway e a VPS. Apenas mover esta aplicação para a VPS não torna endereços privados acessíveis. Câmeras com URL pública compatível podem ser acessadas diretamente pela VPS usando o modo **Saída em nuvem**.

O arquivo [DOCUMENTACAO_APRESENTACAO.md](DOCUMENTACAO_APRESENTACAO.md) contém a visão completa da arquitetura e um roteiro para apresentação acadêmica.

## Segurança

- senhas das contas protegidas com bcrypt (fator 12);
- sessões aleatórias armazenadas no MySQL e enviadas em cookie `HttpOnly` e `SameSite=Strict`;
- proteção CSRF em todas as operações que alteram dados;
- limite de tentativas de login e mensagens que não revelam se uma conta existe;
- dados separados por usuário em todas as consultas;
- credenciais das câmeras cifradas em repouso com AES-256-GCM;
- cabeçalhos de segurança, política de conteúdo e bloqueio da incorporação do painel em sites externos;
- corpo das requisições limitado e validação dos dados de câmera mantida no servidor.

A chave local usada para cifrar as credenciais é criada em `data/app.key` e não é versionada. Faça backup dela junto com o banco: sem essa chave, as senhas das câmeras não podem ser recuperadas. Em outro ambiente, também é possível fornecer uma chave Base64 de 32 bytes por `APP_ENCRYPTION_KEY`.

Para acesso fora do próprio computador, publique o painel somente atrás de HTTPS e de uma rede confiável/VPN. O cookie recebe automaticamente o atributo `Secure` quando a aplicação é acessada por HTTPS.

### Migração da versão anterior

Se existir um `data/database.json`, as câmeras e os grupos antigos são importados automaticamente para a primeira conta criada. Ao concluir, o arquivo passa a se chamar `data/database.json.migrated`.

## Testar com IP Webcam no Android

O celular e o computador devem estar na mesma rede Wi-Fi. No IP Webcam, toque em **Iniciar servidor** e confira o endereço exibido na tela, por exemplo `http://192.168.0.25:8080`.

No painel, selecione **IP Webcam (MJPEG)** e cadastre:

- IP: `192.168.0.25`
- porta: `8080`
- caminho: `/video`
- usuário e senha: somente quando exigidos pelo aplicativo

Antes do cadastro, confirme que `http://192.168.0.25:8080` abre no navegador do computador. O backend encaminha o MJPEG para a interface sem expor as credenciais da câmera.

## Câmeras RTSP convencionais

Para uma câmera que forneça uma URL como `rtsp://usuario:senha@192.168.0.50:554/live`, selecione **Câmera RTSP** e informe IP, porta, caminho e autenticação. Prefira vídeo H.264, que possui melhor compatibilidade com WebRTC nos navegadores.

## Portas utilizadas

- `3000`: aplicação web e API local
- `554` ou outra: porta da câmera, acessada pelo computador
- `8554`: publicação RTSP no MediaMTX
- `8889`: reprodução WebRTC
- `8888`: reprodução HLS do MediaMTX
- `9997`: API local do MediaMTX, restrita a `127.0.0.1`
- `3702/UDP`: descoberta multicast WS-Discovery/ONVIF

O cadastro de contas e câmeras é salvo no MySQL. Não copie o banco nem `data/app.key` para repositórios públicos.
