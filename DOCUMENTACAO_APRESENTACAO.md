# Sentinela — resumo do sistema para apresentação

## 1. Objetivo

O Sentinela é um painel web de monitoramento que reúne câmeras de diferentes ambientes em uma única interface. O usuário cria uma conta, organiza as câmeras em grupos e acompanha transmissões individuais ou mosaicos personalizados em tela cheia.

O projeto procura resolver três problemas comuns:

1. cada fabricante costuma ter um aplicativo diferente;
2. câmeras locais não são diretamente acessíveis fora da casa ou empresa;
3. publicar portas de câmeras na internet cria riscos de segurança.

## 2. Principais recursos

- cadastro e login com separação dos dados de cada usuário;
- criação de grupos, como Casa, Garagem e Empresa;
- descoberta automática de câmeras compatíveis com ONVIF;
- cadastro manual de fontes RTSP, RTSPS, MJPEG e HLS;
- credenciais das câmeras cifradas no banco;
- reprodução no navegador, inclusive em tela cheia;
- mosaicos salvos com grupos e câmeras específicas;
- gateway local com conexão de vídeo sob demanda;
- opção para fontes que já possuem uma URL pública em nuvem;
- guia de conexão para ajudar usuários sem conhecimento de redes.

## 3. Componentes

### Interface web

Exibe o painel, formulários, grupos e mosaicos. O navegador não recebe a senha original da câmera. Ele solicita a transmissão por um caminho controlado pelo sistema.

### Backend Node.js

Valida os dados, autentica usuários, aplica autorização, conversa com o MySQL e configura as fontes no MediaMTX. Para MJPEG, o próprio backend funciona como proxy autenticado.

### MySQL

Armazena usuários, sessões, grupos, câmeras e predefinições de visualização. Cada consulta de câmera é vinculada ao usuário autenticado.

### MediaMTX

Conecta-se às fontes RTSP ou HLS e entrega vídeo compatível ao navegador. As fontes são configuradas sob demanda: elas são abertas quando aparece um leitor e encerradas pouco depois que o último leitor sai.

### Gateway

É o componente que precisa enxergar os endereços locais das câmeras. Na versão atual, o computador que executa Node.js e MediaMTX é o gateway. Em uma implantação comercial com VPS, o mesmo papel deve ser exercido por um conector instalado em um computador, NAS ou mini-PC dentro da rede do cliente.

## 4. Formas de conexão

### Gateway local

Use quando a câmera possui um endereço privado, como `192.168.1.50`.

Fluxo:

```text
Câmera local → Gateway na rede do cliente → Navegador
```

O gateway deve permanecer ligado, mas não mantém todas as transmissões abertas continuamente. O MediaMTX usa uma origem sob demanda. Ao abrir o painel ou um mosaico, o navegador se torna um leitor, o MediaMTX conecta-se à câmera e começa a entregar o vídeo. Dez segundos depois da saída do último leitor, a conexão com a origem é encerrada.

Vantagens:

- não é necessário expor diretamente a câmera na internet;
- reduz tráfego quando ninguém está assistindo;
- funciona com câmeras RTSP comuns;
- mantém as credenciais centralizadas no gateway.

Limitação: o gateway precisa estar ligado e ter acesso à mesma rede da câmera.

### Saída em nuvem

Use quando a câmera ou o fornecedor entrega uma URL pública padrão que pode ser acessada pelo servidor, por exemplo:

- `rtsps://camera.exemplo.com:443/live`;
- `https://video.exemplo.com/camera/index.m3u8`;
- um endpoint MJPEG HTTPS.

Fluxo:

```text
Câmera ou nuvem do fabricante → Servidor/MediaMTX → Navegador
```

Vantagens:

- uma VPS pode acessar a fonte diretamente;
- não exige que o servidor esteja na rede local da câmera;
- pode dispensar um gateway local, dependendo da câmera.

Limitação: funcionar no aplicativo do fabricante não significa que exista uma saída em nuvem utilizável. Muitos aplicativos usam protocolos proprietários. O fabricante precisa oferecer RTSP, RTSPS, HLS ou MJPEG.

### Descoberta ONVIF

É o caminho mais simples para câmeras na rede local. O sistema envia uma busca WS-Discovery, consulta os perfis de mídia da câmera e importa a URL RTSP escolhida. Computador e câmera precisam estar na mesma rede durante a descoberta, e o ONVIF deve estar habilitado.

## 5. Como ficaria com uma VPS

A VPS pode hospedar o painel público, a API, o banco, o MediaMTX e os serviços de autenticação. Entretanto, ela não consegue acessar diretamente um IP privado existente dentro da casa de um cliente.

A arquitetura comercial completa seria:

```text
Câmeras locais
      ↓
Gateway/conector do cliente
      ↓ conexão iniciada de dentro para fora
VPS da empresa
      ↓ HTTPS/WebRTC
Celular ou computador do usuário
```

O conector local deve iniciar junto com o equipamento, autenticar-se na VPS, reconectar automaticamente e publicar o vídeo apenas quando solicitado. Isso evita abrir portas no roteador do cliente.

Esta versão do projeto implementa o comportamento de gateway sob demanda quando o sistema está executando na rede das câmeras e já registra separadamente fontes locais e fontes em nuvem. A transformação em uma topologia distribuída, com conector remoto e VPS, exige ainda o canal seguro entre os dois ambientes, além de domínio, HTTPS e infraestrutura de retransmissão.

## 6. Por que não abrir a porta da câmera no roteador

O redirecionamento direto de portas expõe a interface e o protocolo da câmera para toda a internet. Câmeras podem ter firmware antigo, senhas fracas ou serviços inseguros. O projeto evita esse modelo: o usuário acessa o painel autenticado e o gateway acessa a câmera internamente.

## 7. Segurança implementada

- senhas de conta protegidas com bcrypt;
- sessões aleatórias em cookies `HttpOnly` e `SameSite=Strict`;
- proteção CSRF em operações que alteram dados;
- limite de tentativas de login;
- separação de dados por usuário;
- senhas das câmeras cifradas com AES-256-GCM;
- cabeçalhos de segurança e bloqueio de incorporação do painel;
- validação de IP/host, portas, caminhos e tamanhos de requisição;
- API interna do MediaMTX restrita ao endereço local.

Em produção, a VPS também deve usar HTTPS, firewall, backups, atualizações automáticas, monitoramento e segredos fornecidos por variáveis de ambiente.

## 8. Exemplo de cadastro manual

Dada a URL:

```text
rtsp://visualizador:senha@192.168.1.50:554/Streaming/Channels/101
```

O cadastro é dividido assim:

- modo: Gateway local;
- tipo: RTSP;
- protocolo: RTSP;
- IP: `192.168.1.50`;
- porta: `554`;
- caminho: `/Streaming/Channels/101`;
- usuário: `visualizador`;
- senha: a senha configurada na câmera.

## 9. Roteiro curto para apresentação

“O Sentinela centraliza diferentes câmeras em um painel web seguro. O usuário cria uma conta, encontra câmeras ONVIF ou cadastra uma URL manualmente e organiza tudo em grupos e mosaicos. Para câmeras locais, o servidor atua como gateway e só abre o stream quando alguém está assistindo, reduzindo tráfego e evitando expor a câmera. Para equipamentos que oferecem uma URL pública padronizada, existe o modo de saída em nuvem. O backend protege sessões e credenciais, o MySQL guarda as configurações e o MediaMTX converte as fontes para reprodução no navegador. Em uma implantação comercial, o painel fica na VPS e um conector leve permanece na rede do cliente para alcançar as câmeras locais.”

## 10. Limitações e próximos passos

- criar o conector distribuído que ligará gateways remotos à VPS;
- adicionar HTTPS e domínio na implantação pública;
- configurar STUN/TURN para redes onde WebRTC direto não funcionar;
- adicionar logs de auditoria e recuperação de conta;
- implementar atualização automática e diagnóstico do gateway;
- medir banda e capacidade da VPS conforme número de câmeras e espectadores.
