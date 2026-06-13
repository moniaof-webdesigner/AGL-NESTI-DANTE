# Integração com Google Sheets via Google Apps Script

Esta solução é **100% gratuita**, não depende de n8n, Zapier, Make ou qualquer
plataforma externa, e suporta tranquilamente até 20 envios/dia (o limite
gratuito do Apps Script é de 20.000 requisições/dia).

O fluxo completo é:

1. Usuário preenche o formulário de parceria no popup do site.
2. O `js/form-handler.js` valida os dados e envia via `fetch` (POST) para a
   URL do Web App do Google Apps Script.
3. O Apps Script grava os dados em uma nova linha da planilha Google Sheets.
4. O site exibe a mensagem de sucesso e abre o WhatsApp Comercial com a
   mensagem pré-formatada contendo todos os dados preenchidos.

---

## 1. Estrutura da planilha Google Sheets

Crie uma planilha nova no Google Sheets (ex.: `AGL Brasil - Solicitações de Parceria`)
e renomeie a primeira aba para `Parcerias`. Na primeira linha, crie as colunas
exatamente nesta ordem:

| Coluna | Cabeçalho           | Descrição                                              |
|--------|---------------------|---------------------------------------------------------|
| A      | Data/Hora           | Preenchido automaticamente pelo script (timestamp)      |
| B      | Nome                | Nome completo                                            |
| C      | E-mail              | E-mail corporativo                                       |
| D      | WhatsApp            | Telefone com DDD                                         |
| E      | Empresa             | Nome da empresa                                          |
| F      | CNPJ                | CNPJ informado                                           |
| G      | Segmento            | Segmento da empresa                                      |
| H      | Cargo               | Cargo do solicitante                                     |
| I      | Premium/Importados  | Se já trabalha com produtos premium/importados           |
| J      | Origem              | Como conheceu a Nesti Dante                              |
| K      | Origem do Site      | Domínio de onde o formulário foi enviado                 |
| L      | Data Envio (ISO)    | Data/hora enviada pelo navegador (ISO 8601)              |

> Dica: deixe a primeira linha em negrito e congele-a (Exibir → Congelar →
> 1 linha) para facilitar a leitura.

---

## 2. Código do Google Apps Script

1. Na planilha criada, vá em **Extensões → Apps Script**.
2. Apague qualquer código de exemplo no arquivo `Código.gs` e cole o código
   abaixo.

```javascript
/**
 * AGL Brasil — Recebe os dados do formulário de parceria e grava
 * uma nova linha na planilha "Parcerias".
 *
 * Publicar como Web App (Implantar → Nova implantação → Aplicativo da Web)
 * com:
 *   - Executar como: Eu (sua conta)
 *   - Quem pode acessar: Qualquer pessoa
 */

var SHEET_NAME = 'Parcerias';

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    if (!sheet) {
      return jsonResponse({ status: 'error', message: 'Aba "' + SHEET_NAME + '" não encontrada.' });
    }

    var params = e.parameter || {};

    var row = [
      new Date(),                       // A - Data/Hora (gerado pelo servidor)
      params.nome || '',                // B - Nome
      params.email || '',               // C - E-mail
      params.telefone || '',            // D - WhatsApp
      params.empresa || '',             // E - Empresa
      params.cnpj || '',                // F - CNPJ
      params.segmento || '',            // G - Segmento
      params.cargo || '',               // H - Cargo
      params.premium || '',             // I - Premium/Importados
      params.origem || '',              // J - Origem
      params.origemSite || '',          // K - Origem do Site
      params.dataEnvio || ''            // L - Data Envio (ISO, do navegador)
    ];

    sheet.appendRow(row);

    return jsonResponse({ status: 'success' });
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.message });
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', message: 'AGL Brasil - Apps Script ativo.' });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 3. Publicando como Web App

1. No editor do Apps Script, clique em **Implantar → Nova implantação**.
2. Em "Selecionar tipo", clique no ícone de engrenagem e escolha **App da Web**.
3. Configure:
   - **Descrição**: `AGL - Formulário de Parceria`
   - **Executar como**: `Eu (seu e-mail)`
   - **Quem pode acessar**: `Qualquer pessoa`
4. Clique em **Implantar**.
5. Autorize as permissões solicitadas (sua conta Google precisa aprovar o
   acesso à planilha).
6. Copie a **URL do Web App** gerada — algo como:
   `https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec`

---

## 4. Conectando o site ao Apps Script

1. Abra o arquivo [`js/form-handler.js`](../js/form-handler.js).
2. Localize o objeto `CONFIG` no topo do arquivo:

```javascript
var CONFIG = {
  GAS_WEB_APP_URL: 'COLE_AQUI_A_URL_DO_GOOGLE_APPS_SCRIPT',
  WHATSAPP_NUMBER: '5511999999999'
};
```

3. Substitua `GAS_WEB_APP_URL` pela URL copiada no passo anterior.
4. Substitua `WHATSAPP_NUMBER` pelo número do WhatsApp Comercial da AGL,
   no formato internacional, somente dígitos (ex.: `55` + DDD + número).
5. No arquivo [`index.html`](../index.html), atualize também os links que
   apontam para `https://wa.me/5511999999999` (no rodapé) com o mesmo número.

---

## 5. Atualizando o script (importante)

Sempre que você editar o código do Apps Script (`Código.gs`), é necessário
criar uma **nova implantação** ou **gerenciar implantações → editar →
nova versão** para que as alterações entrem em vigor na URL publicada.

---

## 6. Sobre o modo `no-cors`

O `fetch` no `form-handler.js` usa `mode: 'no-cors'`, pois o Apps Script não
permite leitura completa da resposta por requisições cross-origin do
navegador. Isso significa que o JavaScript não consegue ler o corpo da
resposta (`status: 'success'`), mas a requisição **é entregue normalmente**
ao script e a linha **é gravada na planilha**. O site trata a ausência de
erro de rede como sucesso, exibe a mensagem de confirmação e abre o
WhatsApp automaticamente.

Se no futuro for necessário ler a resposta (ex.: para validações no
servidor), será preciso hospedar um pequeno proxy (ex.: Cloudflare Worker)
— mas para o escopo atual (até 20 envios/dia, sem necessidade de resposta
síncrona), a abordagem `no-cors` é a mais simples, gratuita e suficiente.
