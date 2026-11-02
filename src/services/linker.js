/**
 * Serviços de upload de imagem e geração de link.
 *
 * @author Dev Yanik
 */
import axios from "axios";
import FormData from "form-data";
import { LINKER_BASE_URL, PREFIX } from "../config.js";
import { getApiKey } from "../utils/database.js";

/**
 * Não configure a chave do Linker no config: defina-a pelo WhatsApp com
 * `.api-keys linker <chave>`, que a guarda em `database/config.json`. Sem ela, o
 * token da Spider X API é usado como alternativa.
 */
function isApiKeyConfigured(apiKey) {
  return (
    typeof apiKey === "string" &&
    apiKey.trim() !== "" &&
    apiKey !== "seu_token_aqui"
  );
}

const messageIfKeyNotConfigured = `API Key do Linker ou token da Spider X API não configurado!

Para configurar pelo WhatsApp, use:

\`${PREFIX}api-keys linker sua_chave_aqui\`

ou, para usar o token da Spider X API como alternativa:

\`${PREFIX}set-spider-api-token seu_token_aqui\`

Para obter uma API Key do Linker:
1. Acesse: https://linker.devyaniik.dev
2. Faça login ou crie uma conta entrando com sua conta Google
3. Vá em *Configurações*
4. Copie sua API Key

Para usar a Spider X API, crie uma conta em: https://api.spiderx.com.br`;

function getUploadApiKey() {
  const linkerKey = getApiKey("linker_api_key");

  if (isApiKeyConfigured(linkerKey)) {
    return linkerKey;
  }

  const spiderApiToken = getApiKey("spider_api_token");

  if (isApiKeyConfigured(spiderApiToken)) {
    return spiderApiToken;
  }

  throw new Error(messageIfKeyNotConfigured);
}

export async function upload(imageBuffer, filename) {
  if (!Buffer.isBuffer(imageBuffer)) {
    throw new Error("O primeiro parâmetro deve ser um Buffer válido!");
  }

  if (typeof filename !== "string" || filename.trim() === "") {
    throw new Error("O segundo parâmetro deve ser o nome do arquivo!");
  }

  if (imageBuffer.length === 0) {
    throw new Error("O buffer da imagem está vazio!");
  }

  const apiKey = getUploadApiKey();

  const formData = new FormData();
  formData.append("file", imageBuffer, {
    filename: filename,
    contentType: "image/jpeg",
  });

  const response = await axios.post(`${LINKER_BASE_URL}/upload`, formData, {
    headers: {
      "X-API-Key": apiKey,
      ...formData.getHeaders(),
    },
  });

  const result = response.data;

  if (!result.url) {
    throw new Error(`Erro na API: ${result.error || "Erro desconhecido"}`);
  }

  return result.url;
}
