/*
 * Ponto de entrada de compatibilidade.
 *
 * O código do bot vive em "src/index.js", mas alguns painéis de hospedagem
 * (Render, Pterodactyl, etc.) iniciam o projeto executando "node index.js" na
 * raiz do repositório. Este arquivo apenas encaminha a inicialização para o
 * ponto de entrada real, evitando o erro:
 *
 *   Error: Cannot find module '/opt/render/project/src/index.js'
 *
 * Se você roda o bot com "npm start", este arquivo não é utilizado.
 */
import "./src/index.js";
