# Integração do formulário de parceria: Google Sheets + RD Station (v2)

O código-fonte do Apps Script fica em [`apps-script/Code.gs`](../apps-script/Code.gs)
(com o manifesto [`appsscript.json`](../apps-script/appsscript.json)). **Nenhuma
credencial é guardada no repositório.**

## Fluxo

1. A pessoa preenche o formulário; `js/form-handler.js` valida (regras do front
   inalteradas) e envia um POST (CORS) ao Web App do Apps Script, com um
   `submissionId` (UUID por tentativa).
2. O Apps Script valida no servidor (inclui os dígitos verificadores do CNPJ),
   trava com `LockService`, verifica **repetição técnica** (ver "Duplicidade") e
   grava uma linha na aba `Parcerias` (colunas **A–R**, sem mudanças).
3. Só depois da gravação confirmada, registra o controle na aba
   `Controle_Envios` e, no modo `live`, envia a conversão `partnershipForm` pela
   API oficial da RD Station.
4. Responde JSON: `success`, `duplicate`, `invalid` ou `error`. O site só mostra
   sucesso quando o servidor devolve `success`.

## Duplicidade (nunca bloqueia uma pessoa por e-mail)

Quem já enviou pode enviar de novo, por exemplo para corrigir o segmento. O
servidor só barra repetição técnica:

| Situação | Resultado |
|---|---|
| Mesmo `submissionId` (para sempre) | Devolve o resultado original; nenhuma linha nem conversão nova |
| Mesmo e-mail e **mesmo conteúdo de negócio** em até `DUP_IDENTICO_HORAS` (24 h) | `duplicate`: "Você já enviou seu formulário." |
| Qualquer campo de negócio diferente (segmento, CNPJ, empresa...) | Novo envio: nova linha e nova conversão |
| Mesmo conteúdo depois de 24 h | Novo envio |

Conteúdo de negócio: nome, e-mail, telefone, empresa, CNPJ, segmento, segmento
"outro" (só quando o segmento é "Outro"), cargo, premium e como conheceu. A
comparação ignora maiúsculas, espaços e máscaras de telefone/CNPJ. UTMs, cookies
da RD, data e `submissionId` **não** entram. A comparação usa a aba `Parcerias`,
então vale também para linhas anteriores ao v2. O navegador não guarda nada sobre
o e-mail; o site só reaproveita o `submissionId` de uma tentativa com falha de
rede se os dados não mudaram.

**Ordem por e-mail.** Só a linha não enviada mais antiga de cada e-mail
(`pending`, `sending` ou `failed`) é elegível para a RD. Um envio novo espera o
mais antigo do mesmo e-mail e sai logo depois (até 5 min, no gatilho), para que
uma conversão antiga nunca sobrescreva dados mais recentes. Isso vale para
`processarPendentes`, `reenviarFalhas` e `enfileirarOffDesde`. Uma linha `failed`
segura as mais novas do mesmo e-mail até alguém executar `reenviarFalhas()`.

**Alerta de mudança de segmento.** Quando um e-mail reenvia com outro segmento
(ou outro texto de "Outro"), é enviado um aviso com a linha da planilha e os dois
segmentos, sem dados pessoais. **Só é enviado se `ALERT_EMAIL` estiver definido**
(não usa o dono do script). Em qualquer caso a mudança fica registrada em
`campos_alterados`.

## Aba `Parcerias` (A–R, inalterada)

A Data/Hora · B Nome · C E-mail · D WhatsApp · E Empresa · F CNPJ · G Segmento ·
H Segmento (Outro) · I Cargo · J Premium/Importados · K Como conheceu a Nesti
Dante · L Origem · M Data Envio (ISO) · N UTM Source · O UTM Medium · P UTM
Campaign · Q UTM Content · R UTM Term

Textos que começam com `=`, `+`, `-` ou `@` recebem um apóstrofo para o Sheets
não interpretá-los como fórmula.

## Aba `Controle_Envios` (criada automaticamente)

`submissionId`, `email_normalizado`, `linha_parcerias`, `criado_em`,
`modo_na_criacao`, `rd_status`, `rd_tentativas`, `rd_proxima_tentativa`,
`rd_ultima_tentativa`, `rd_event_uuid`, `rd_ultimo_erro`, `rd_payload`,
`enviando_desde`, `impressao_digital` (hash do conteúdo de negócio), `reenvio`
(`sim` se o e-mail já tinha envio anterior), `campos_alterados` (campos que mudaram
em relação ao envio anterior; `nenhum` se foi o mesmo conteúdo depois da janela).

`rd_status`: `off` · `dry` · `sending` · `pending` · `sent` · `failed`.

## Propriedades do script (Configurações do projeto → Propriedades do script)

| Propriedade | Uso |
|---|---|
| `RD_API_KEY` | Chave de API da RD ("Gerar chave de API" em App Store → Publicador). Só aqui. |
| `RD_MODE` | `off` (padrão), `dry` ou `live` |
| `ALERT_EMAIL` | Opcional. Destino dos alertas de falha (padrão: dono do script) e **obrigatório** para o alerta de mudança de segmento (sem ele, esse alerta não é enviado) |

## Modos

| Modo | Planilha | RD | Linha de controle |
|---|---|---|---|
| `off` | grava | **não envia** | `off` (guarda o payload) |
| `dry` | grava | **não envia**; guarda o payload | `dry` |
| `live` | grava | envia após a gravação | `sending` → `sent` / `pending` / `failed` |

Regras de pendências:

- Linhas `off` e `dry` **nunca** são reenviadas automaticamente. Isso evita
  duplicar conversões que a captura automática antiga da RD já registrou.
- Na virada, depois de interromper a captura automática na RD, execute **uma vez**
  `enfileirarOffDesde('2026-MM-DDTHH:MM:SS-03:00')` com o horário em que a
  captura foi interrompida. Só as linhas `off` criadas a partir dele são
  enviadas.
- O reenvio automático (`processarPendentes`, a cada 5 min) só age em `live`.
- Falhas temporárias (rede, 429, 5xx): `pending` com espera crescente
  (5 min, 15 min, 1 h, 3 h, 6 h, 12 h, 24 h, 24 h), no máximo 8 tentativas; depois
  `failed` (aparece no resumo diário por e-mail; `reenviarFalhas()` recoloca na fila).
- Erro 400 de campo personalizado inválido: reenvia sem o campo e registra o aviso.
- Erro 401/403: a fila é congelada e há alerta por e-mail. Corrija `RD_API_KEY`
  e execute `retomarRD()`.

## Funções operacionais (executar pelo editor do Apps Script)

`instalarGatilhos()` · `processarPendentes()` · `enfileirarOffDesde(iso)` ·
`reenviarFalhas()` · `retomarRD()` · `statusResumo()` · `resumoDiario()`

## Campos enviados à RD (`conversion_identifier`: `partnershipForm`)

| Formulário | RD |
|---|---|
| nome / email | `name` / `email` |
| telefone | `phone` e `personal_phone` (confirmar com lead real) |
| empresa | `company_name` |
| cargo | `job_title` |
| cnpj | `cf_cnpj` |
| segmento / segmento_outro | `cf_qual_o_segmento_da_sua_empresa` / `cf_segmento_outro` |
| premium | `cf_sua_empresa_ja_trabalha_com_produtos_premium_ou_importad_0` |
| comoConheceuNestiDante | `cf_como_conheceram_a_nesti_dante` |
| utm_* | `cf_utm_source`, `cf_utm_medium`, `cf_utm_campain` (grafia da RD), `cf_utm_content`, `cf_utm_term` |
| cookie `_rdtrk` (ou `rdtrk`) | `client_tracking_id` |
| cookie `__trf.src` ou UTMs | `traffic_source` (+ `traffic_medium`, `traffic_campaign`, `traffic_value`), ver regra abaixo |

**Origem do lead.** Os UTMs seguem indo aos campos `cf_utm_*`, mas a "Origem" da RD só é calculada a partir dos campos `traffic_*`:

- com o cookie `__trf.src`: `traffic_source` recebe o valor bruto do cookie e `traffic_medium`, `traffic_campaign` e `traffic_value` ficam vazios (exigência da RD);
- sem o cookie, mas com `utm_source`: `traffic_source`=`utm_source`, `traffic_medium`=`utm_medium`, `traffic_campaign`=`utm_campaign`, `traffic_value`=`utm_term`;
- sem cookie e sem UTM: nada é enviado (a RD mostra "Desconhecido"; não inventamos origem).

O cookie `__trf.src` nunca é truncado (acima de 4000 caracteres é descartado e vale o UTM). O `client_tracking_id` só é aceito no formato de UUID/identificador. Os cookies da RD são apenas lidos pelo site.

Campos vazios são omitidos. O hostname do site (coluna L) **não** é enviado ao
campo personalizado "Origem" (`RD_SEND_ORIGEM_HOST = false`) para não sobrescrever
valores de outras integrações.

## Publicação do Apps Script

1. Editor do Apps Script → cole `Code.gs`; em Configurações do projeto, ative
   "Mostrar o arquivo de manifesto appsscript.json" e use o conteúdo do manifesto.
2. Defina as propriedades (`RD_API_KEY`, `RD_MODE`).
3. Execute `instalarGatilhos()` e autorize os novos escopos (chamadas externas,
   gatilhos, e-mail).
4. Implantar → **Gerenciar implantações** → editar a implantação existente →
   **Nova versão** (a URL do Web App não muda). Acesso: "Qualquer pessoa".

## Reversão

A captura automática antiga da RD e a API **nunca** podem ficar ativas ao mesmo
tempo. Se a RD já estiver em `live`, reverta nesta ordem, em menos de um minuto:
(1) defina `RD_MODE=off` (instantâneo; a planilha continua gravando),
(2) reative a captura automática do `partnershipForm` na RD,
(3) só então volte a versão do script (Gerenciar implantações → editar a
implantação existente → versão anterior; **não** crie nova implantação) e
(4) reverta o `form-handler.js`.
Linhas gravadas entre (1) e (2) ficam como `off` e linhas `pending`/`failed` na
hora da reversão não são reenviadas sozinhas: conferir caso a caso na RD.
Propriedades, gatilhos e a aba `Controle_Envios` não voltam com a versão.

## Testes locais

```
cd tests
npm install
npm test
```

Os testes simulam Sheets, Lock, UrlFetch e o navegador. **Não fazem nenhuma
chamada real** à RD, ao Google ou à rede.
