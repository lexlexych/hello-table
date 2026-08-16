import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { BCRYPT_COST, hashPassword } from "../lib/users";

/**
 * Печатает bcrypt-хеш пароля для вставки в `.env` (PROJECT.md §7.1).
 * Пароль вводится с клавиатуры и не отображается — в аргументы командной строки его
 * передавать нельзя, иначе он останется в истории оболочки.
 */

const MIN_LENGTH = 12;

let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) {
      process.stdout.write(chunk as Buffer | string, encoding);
    }
    callback();
  },
});

async function askHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const answer = rl.question(prompt);
  muted = true;
  const value = await answer;
  muted = false;
  process.stdout.write("\n");
  rl.close();
  return value;
}

const password = await askHidden("Пароль: ");
if (password.length < MIN_LENGTH) {
  console.error(`Пароль короче ${MIN_LENGTH} символов.`);
  process.exit(1);
}

const repeat = await askHidden("Ещё раз: ");
if (password !== repeat) {
  console.error("Пароли не совпадают.");
  process.exit(1);
}

console.log(`\nbcrypt, cost ${BCRYPT_COST}:\n`);
console.log(await hashPassword(password));
console.log(
  "\nВставьте значение в ADMIN_PASSWORD_HASH или OPERATOR_PASSWORD_HASH в .env",
);
