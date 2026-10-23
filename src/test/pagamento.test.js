import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OWNER_CONTACT,
  PAYMENT_E_MOLA_NAME,
  PAYMENT_E_MOLA_NUMBER,
  PAYMENT_M_PESA_NAME,
  PAYMENT_M_PESA_NUMBER,
} from "../config.js";
import { paymentMessage } from "../commands/member/pagamento.js";
import { commandCost } from "../services/credits.js";

/**
 * O comando `.pagamento` mostra os números que recebem o dinheiro, cada um
 * seguido do respetivo titular: sem o nome, o usuário não sabe a quem está a
 * transferir e pode desconfiar do número.
 */

test("mostra os dois números de transferência", () => {
  const texto = paymentMessage();

  assert.match(texto, new RegExp(PAYMENT_E_MOLA_NUMBER));
  assert.match(texto, new RegExp(PAYMENT_M_PESA_NUMBER));
  assert.match(texto, /e-mola/i);
  assert.match(texto, /m-pesa/i);
});

test("o titular aparece logo abaixo do respetivo número", () => {
  const linhas = paymentMessage().split("\n");
  const indiceEmola = linhas.findIndex((linha) =>
    linha.includes(PAYMENT_E_MOLA_NUMBER),
  );
  const indiceMpesa = linhas.findIndex((linha) =>
    linha.includes(PAYMENT_M_PESA_NUMBER),
  );

  assert.equal(linhas[indiceEmola + 1].includes(PAYMENT_E_MOLA_NAME), true);
  assert.equal(linhas[indiceMpesa + 1].includes(PAYMENT_M_PESA_NAME), true);

  // Os titulares não podem estar trocados.
  assert.equal(linhas[indiceEmola + 1].includes(PAYMENT_M_PESA_NAME), false);
  assert.equal(linhas[indiceMpesa + 1].includes(PAYMENT_E_MOLA_NAME), false);
});

test("Yanik fica no e-mola e Helton no m-pesa", () => {
  assert.equal(PAYMENT_E_MOLA_NAME, "Yanik");
  assert.equal(PAYMENT_M_PESA_NAME, "Helton");
});

test("inclui o link de contacto do dono quando OWNER_CONTACT está definido", () => {
  assert.equal(OWNER_CONTACT, "258834788141");
  assert.match(paymentMessage(), /https:\/\/wa\.me\/258834788141/);
});

test("explica que é preciso reencaminhar o SMS do comprovativo", () => {
  const texto = paymentMessage();

  assert.match(texto, /reencaminha o SMS/i);
});

test("o comando é isento de créditos", () => {
  assert.equal(commandCost({ name: "pagamento" }, "pagamento"), 0);
});
