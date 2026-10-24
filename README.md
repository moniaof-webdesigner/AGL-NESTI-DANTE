# AGL Brasil — Site Institucional (Distribuidora Oficial Nesti Dante)

Site institucional premium em **HTML5, CSS3 e JavaScript puro**, sem
frameworks ou dependências externas, pronto para publicação em hospedagem
compartilhada comum.

## Estrutura de pastas

```
/
├── index.html
├── robots.txt
├── sitemap.xml
├── css/
│   ├── style.css        # Estilos base, variáveis, layout e componentes
│   └── responsive.css   # Media queries (mobile-first)
├── js/
│   ├── main.js          # Navegação, modal, animações de entrada
│   └── form-handler.js  # Validação e envio ao Apps Script (Sheets + RD)
├── assets/
│   ├── images/          # Imagens de seção (ex.: bg-hero-agl.avif)
│   ├── icons/           # Ícones SVG/PNG
│   └── logos/           # Logotipos (AGL e Nesti Dante)
├── components/          # Notas sobre componentes reutilizáveis
└── docs/
    └── google-apps-script.md  # Guia completo da integração
```

## Como publicar

1. Faça upload de todos os arquivos e pastas para a raiz do seu domínio
   (ex.: `public_html/`).
2. Configure a integração com Google Sheets + RD Station seguindo o guia em
   [`docs/google-apps-script.md`](docs/google-apps-script.md).
3. Atualize em `index.html`:
   - Links de WhatsApp (`https://wa.me/55...`) no rodapé.
   - URL canônica e meta tags Open Graph (`https://aglbrasil.com.br/`).
4. Atualize em `js/form-handler.js`:
   - `CONFIG.GAS_WEB_APP_URL` com a URL do Web App do Apps Script.

## Formulário de Parceria Comercial

O formulário é exibido em um modal acessível (foco preso, fechamento via
`Esc`, overlay e botão "X"). Pode ser aberto por qualquer elemento com o
atributo `data-open-modal` (botões do header, hero, CTA final e rodapé).

Ao enviar com sucesso:

1. O Apps Script valida, grava uma nova linha na planilha Google Sheets e
   confirma ao site (o site só mostra sucesso após essa confirmação).
2. Depois da gravação, o Apps Script registra a conversão `partnershipForm` na
   RD Station pela API oficial (ver `docs/google-apps-script.md`).
3. É exibida uma mensagem de sucesso dentro do modal. Repetir exatamente o mesmo
   preenchimento em até 24 h mostra "Você já enviou seu formulário."; quem
   altera qualquer informação (por exemplo o segmento) envia normalmente.

## Boas práticas aplicadas

- **SEO técnico**: meta tags completas, Open Graph, Twitter Card, dados
  estruturados (Schema.org `Organization` e `BreadcrumbList`), `robots.txt`,
  `sitemap.xml`, URLs canônicas, hierarquia de headings (`h1` único por
  página) e atributos `alt` descritivos.
- **Acessibilidade**: skip link, `aria-label`/`aria-expanded`/`aria-modal`,
  foco visível, foco preso no modal, fechamento por teclado (`Esc`),
  contraste de cores validado com a paleta oficial Nesti Dante, formulário
  com `<label>`, mensagens de erro associadas via `aria-live`.
- **Performance**: `preload` de imagens críticas, `fetchpriority="high"`
  no LCP, `loading="lazy"` em imagens secundárias, CSS/JS enxutos sem
  dependências externas, `defer` nos scripts.
- **UX**: navegação fixa com destaque de seções, CTAs consistentes,
  microanimações discretas (respeitando `prefers-reduced-motion`), modal
  com etapas de formulário e confirmação de sucesso.
