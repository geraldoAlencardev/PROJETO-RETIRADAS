// Cria um usuário do sistema.
// Uso: npm run user:create -- --login admin --nome "Administrador"
// A senha é pedida no terminal (sem eco). Para uso não interativo, defina a variável SENHA.
import readline from 'node:readline';
import { hashSenha, SENHA_MAX_BYTES, SENHA_MIN } from '../modules/usuarios/senha.js';
import { buscarPorLogin, criarUsuario } from '../modules/usuarios/usuarios.repository.js';
import { prisma } from '../shared/prisma.js';

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function perguntarSenha(pergunta: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Suprime o eco dos caracteres digitados.
    let mudo = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (!mudo) process.stdout.write(s);
    };
    process.stdout.write(pergunta);
    mudo = true;
    rl.question('', (resposta) => {
      mudo = false;
      rl.close();
      process.stdout.write('\n');
      resolve(resposta);
    });
  });
}

async function main() {
  const login = argumento('login')?.trim().toLowerCase();
  const nome = argumento('nome')?.trim();
  if (!login || !nome) {
    throw new Error('Uso: npm run user:create -- --login <login> --nome "<Nome completo>"');
  }
  if (await buscarPorLogin(login)) {
    throw new Error(`Já existe um usuário com o login "${login}".`);
  }

  let senha = process.env.SENHA;
  if (!senha) {
    senha = await perguntarSenha('Senha: ');
    const confirmacao = await perguntarSenha('Confirme a senha: ');
    if (senha !== confirmacao) throw new Error('As senhas não conferem.');
  }
  if (senha.length < SENHA_MIN) {
    throw new Error(`A senha deve ter pelo menos ${SENHA_MIN} caracteres.`);
  }
  if (Buffer.byteLength(senha) > SENHA_MAX_BYTES) {
    throw new Error(`A senha deve ter no máximo ${SENHA_MAX_BYTES} bytes.`);
  }

  const { id } = await criarUsuario({ nome, login, senhaHash: await hashSenha(senha) });
  console.log(`✔ Usuário "${login}" criado (id ${id}).`);
}

main()
  .catch((err: unknown) => {
    console.error(`✖ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
