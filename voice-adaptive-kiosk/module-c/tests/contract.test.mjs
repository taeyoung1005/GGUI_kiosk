import test from "node:test";
import assert from "node:assert/strict";
import { buildDataContract } from "../src/contract.js";
import { resolveProfile } from "../src/adapt.js";

const profile = resolveProfile();

for (const [step, action] of [
  ["fulfillment", "setFulfillment"],
  ["loyalty", "setLoyalty"],
  ["payment", "setPayment"],
  ["confirm", "confirmYes"],
]) {
  test(`contract exposes ${step} action and shared order context props`, () => {
    const contract = buildDataContract(step, { candidates: [], profile });
    assert.match(contract.intent, /고령자 친화 키오스크/);
    assert.ok(contract.propsSpec.properties.orderState);
    assert.ok(contract.propsSpec.properties.possibleActions);
    assert.ok(contract.actionSpec[action]);
    // 적응 강도 입력(assistLevel/ageGroup)은 계약 props 에서 제거됨.
    assert.equal(contract.propsSpec.properties.assistLevel, undefined);
    assert.equal(contract.propsSpec.properties.ageGroup, undefined);
    if (["fulfillment", "loyalty", "payment"].includes(step)) {
      assert.ok(contract.propsSpec.properties.total);
    }
  });
}
