import test from "node:test";
import assert from "node:assert/strict";
import { buildDataContract } from "../src/contract.js";
import { resolveProfile } from "../src/adapt.js";

const profile = resolveProfile({ age_group: "senior_adult", assist_level: 2 });

for (const [step, action] of [
  ["fulfillment", "setFulfillment"],
  ["loyalty", "setLoyalty"],
  ["payment", "setPayment"],
  ["confirm", "confirmYes"],
]) {
  test(`contract exposes ${step} action and shared order context props`, () => {
    const contract = buildDataContract(step, { candidates: [], profile });
    assert.match(contract.intent, /Senior-friendly kiosk/);
    assert.ok(contract.propsSpec.properties.orderState);
    assert.ok(contract.propsSpec.properties.possibleActions);
    assert.ok(contract.actionSpec[action]);
    if (["fulfillment", "loyalty", "payment"].includes(step)) {
      assert.ok(contract.propsSpec.properties.total);
    }
  });
}
