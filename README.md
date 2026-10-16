# ARCANJO Intelligence — Segurança Patrimonial para Templos Religiosos

Sistema Full-Stack para gestão de segurança patrimonial, rondas auditadas por **QR Code + GPS**, checklists operacionais por turno, controle de salas restritas/ativos, gestão de **Equipe** (perfis e credenciais) e **Quadro Mensal de Escala**.

---

## ✨ Funcionalidades Principais

- **Autenticação & Controle de Acesso:** Login com usuário/e-mail e senha criptografada (`PBKDF2-HMAC-SHA256`), alteração de senha pelo próprio usuário e bloqueio imediato de perfis inativos.
- **Painel Geral (SaaS Dashboard):** KPIs em tempo real, curva operacional de cobertura por setor, índice geral de prontidão e status das 6 áreas do templo.
- **Rondas & Postos (QR Code + GPS):** Leitura de QR Code via câmera ou token, validação de raio geográfico (Haversine) e impressão de etiquetas QR para os postos físicos.
- **Checklists por Turno:** Verificações divididas em *Abertura / Pré-Culto*, *Durante o Culto* e *Fechamento Patrimonial*.
- **Patrimônio & Salas Restritas:** Custódia de equipamentos de áudio/vídeo, tesouraria (dupla custódia), claviculário e DEA.
- **Ocorrências:** Registro e acompanhamento de incidentes, quase-incidentes e emergências.
- **Equipe:** Cadastro completo de perfis (Pastor, Gestor de Segurança, Obreiros, Equipe de Segurança), ativação/desativação e gerenciamento de credenciais.
- **Escala (Quadro Mensal):** Calendário visual de 7 colunas (`Segunda` a `Domingo`) com alocação por dia, posto e turno, indicação automática de `NIHILL` e modo de impressão.

---

## 🚀 Como Executar Localmente

1. Crie e ative o ambiente virtual Python:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\activate
   ```
2. Instale as dependências:
   ```powershell
   pip install -r requirements.txt
   ```
3. Inicie o servidor:
   ```powershell
   python app.py
   ```
4. Acesse no navegador: **`http://localhost:8000`** (Senha padrão de demonstração: `123456`).

---

## ☁️ Deploy na Vercel + Supabase (PostgreSQL)

O projeto já está estruturado de forma híbrida:
- **Localmente (sem `DATABASE_URL`):** utiliza automaticamente o banco **SQLite** (`arcanjo.db`).
- **Em Produção (com `DATABASE_URL`):** conecta-se automaticamente ao **Supabase (PostgreSQL)**, criando as tabelas e populando os dados iniciais no primeiro acesso.

### Passo 1 — Configurar o Banco no Supabase
1. Crie um projeto no [Supabase](https://supabase.com/).
2. Vá em **Project Settings → Database → Connection string → URI** (recomendado usar a porta `5432` ou `6543` no modo *Session*).
3. Copie a URL de conexão:
   ```text
   postgresql://postgres.[SEU-REF]:[SUA-SENHA]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   ```
   *(Opcional: se desejar criar as tabelas manualmente antes do deploy, execute o conteúdo do arquivo [`supabase_schema.sql`](./supabase_schema.sql) no **SQL Editor** do Supabase).*

### Passo 2 — Deploy na Vercel
1. Importe o repositório `https://github.com/AlanGalvao83/ARCANJO.git` na [Vercel](https://vercel.com/).
2. Em **Environment Variables**, adicione:
   - `DATABASE_URL` = sua string de conexão URI do Supabase.
3. Clique em **Deploy**. O arquivo [`vercel.json`](./vercel.json) e o entrypoint [`api/index.py`](./api/index.py) configurarão automaticamente as rotas da API FastAPI e a interface estática.
