# Componentes

Como o projeto é HTML5 puro (sem frameworks), os componentes reutilizáveis
são mantidos diretamente no `index.html`, organizados em seções claramente
identificadas por comentários:

- **Header / Navegação** — `<header class="header" id="header">`
- **Hero** — `<section class="hero" id="topo">`
- **Modal de Parceria Comercial** — `<div class="modal" id="partnershipModal">`
- **Footer** — `<footer class="footer" id="contato">`

Esta pasta é reservada para snippets HTML reutilizáveis caso o site evolua
para múltiplas páginas (ex.: `header.html`, `footer.html`, `modal-parceria.html`)
e passe a usar um processo de build ou includes do servidor (SSI/PHP) para
montagem das páginas sem duplicar código.
