# Crédito Simulação

Simulador pessoal de crédito habitação, preparado como site estático para Cloudflare Pages. Não usa backend, Workers, Pages Functions, lambdas ou base de dados.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Abre `http://localhost:4173`.

Para validar o motor financeiro:

```bash
npm test
```

## Deploy no Cloudflare Pages

1. Cria um repositório remoto vazio no GitHub/GitLab e faz push deste projeto.
2. No painel Cloudflare, abre **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Escolhe o repositório e configura:
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node.js version: `20` ou superior
4. Clica em **Save and Deploy**.

O Cloudflare volta a publicar o site em cada push para a branch configurada. Como é um site estático, não é necessário criar Worker, Function, Lambda, secret ou variável de backend.

### Deploy direto pelo terminal

Depois de fazer login uma vez:

```bash
npx wrangler login
npm run deploy
```

Se o projeto Pages ainda não existir, o comando pede o nome e cria-o. Para usar outro nome, altera `--project-name credito-simulacao` no `package.json`.

## Limitação conhecida

O browser consulta diretamente o endpoint público de propostas. O endpoint precisa aceitar pedidos CORS a partir do domínio Pages; se não aceitar, a consulta não pode funcionar num site estático sem introduzir um backend/proxy.
