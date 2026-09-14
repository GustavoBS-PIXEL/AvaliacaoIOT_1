# Painel de Segurança IoT

Aplicação local para cadastrar câmeras RTSP e visualizar as transmissões no navegador. O backend Node.js mantém os cadastros e configura o MediaMTX, que converte RTSP para WebRTC.

## Executar no Windows

Requisitos: Node.js 20 ou superior e acesso à internet durante a instalação inicial.

```powershell
npm run setup
npm start
```

Abra `http://127.0.0.1:3000`. O comando `npm start` inicia tanto o painel quanto o MediaMTX instalado pelo setup.
O `setup` precisa ser executado apenas uma vez; repeti-lo detecta a instalação existente sem tentar substituir o executável em uso.

Quando uma câmera estiver online, clique sobre a imagem para visualizá-la em tela cheia. Pressione `Esc` para retornar ao painel.

## Descoberta automática ONVIF

Use **Buscar câmeras** para localizar dispositivos ONVIF na rede local. O backend envia probes WS-Discovery pelas interfaces IPv4 ativas, identifica os dispositivos, autentica usando WS-Security ou HTTP Digest, consulta seus perfis de mídia e importa a URL RTSP selecionada.

Para a descoberta funcionar:

- computador e câmera devem estar na mesma sub-rede;
- ONVIF deve estar habilitado na câmera;
- multicast e UDP `3702` não podem estar bloqueados;
- o roteador não pode usar isolamento de clientes Wi-Fi;
- algumas marcas exigem criar um usuário ONVIF separado.

As credenciais usadas durante a consulta ficam temporariamente apenas na memória. Depois da importação, passam a integrar o cadastro local da câmera em `data/database.json`.

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
- `9997`: API local do MediaMTX, restrita a `127.0.0.1`
- `3702/UDP`: descoberta multicast WS-Discovery/ONVIF

Os cadastros são salvos em `data/database.json`, que não é versionado pelo Git por conter informações sensíveis das câmeras.
