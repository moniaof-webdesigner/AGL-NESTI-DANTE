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
│   └── form-handler.js  # Validação, envio Google Sheets + WhatsApp
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
2. Configure a integração com Google Sheets + WhatsApp seguindo o guia em
   [`docs/google-apps-script.md`](docs/google-apps-script.md).
3. Atualize em `index.html`:
   - Links de WhatsApp (`https://wa.me/55...`) no rodapé.
   - URL canônica e meta tags Open Graph (`https://aglbrasil.com.br/`).
4. Atualize em `js/form-handler.js`:
   - `CONFIG.GAS_WEB_APP_URL` com a URL do Web App do Apps Script.
   - `CONFIG.WHATSAPP_NUMBER` com o número do WhatsApp Comercial.

## Formulário de Parceria Comercial

O formulário é exibido em um modal acessível (foco preso, fechamento via
`Esc`, overlay e botão "X"). Pode ser aberto por qualquer elemento com o
atributo `data-open-modal` (botões do header, hero, CTA final e rodapé).

Ao enviar com sucesso:

1. Os dados são gravados em uma nova linha da planilha Google Sheets via
   Google Apps Script.
2. É exibida uma mensagem de sucesso dentro do modal.
3. O WhatsApp Comercial é aberto automaticamente em uma nova aba, com uma
   mensagem pré-formatada contendo todos os dados preenchidos.

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
