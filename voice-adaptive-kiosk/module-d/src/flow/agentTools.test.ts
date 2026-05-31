import { describe, expect, it } from "vitest";
import type { Menu, MenuItem } from "@contracts/types";
import { AGENT_TOOLS, buildAgentInstructions, slimMenu } from "./agentTools";

const sampleItem: MenuItem = {
  id: "caffe-latte-003",
  name: "카페라떼",
  category: "라떼",
  price: 4500,
  image_url: "",
  desc: "기본 라떼",
  options: [
    {
      type: "온도",
      choices: [
        { label: "뜨겁게", price_delta: 0 },
        { label: "차갑게", price_delta: 0 },
      ],
    },
  ],
};

const menu: Menu = {
  restaurant: "OBA 카페",
  categories: ["라떼"],
  items: [sampleItem],
};

describe("agentTools", () => {
  it("도구 목록에 핵심 도구가 다 있다", () => {
    const names = AGENT_TOOLS.map((tool) => tool.name);
    for (const name of [
      "select_item",
      "set_option",
      "set_fulfillment",
      "set_loyalty",
      "set_payment",
      "confirm_order",
      "cancel_order",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("모든 도구가 function 타입 + name + parameters(JSON schema)를 갖는다", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.type).toBe("function");
      expect(typeof tool.name).toBe("string");
      expect(tool.parameters).toBeTruthy();
      expect(tool.parameters.type).toBe("object");
    }
  });

  it("slimMenu는 item_id/이름/가격/옵션타입만 남긴다", () => {
    const slimmed = slimMenu(menu);
    expect(slimmed[0]).toEqual({
      id: "caffe-latte-003",
      name: "카페라떼",
      category: "라떼",
      price: 4500,
      option_types: ["온도"],
    });
  });

  it("buildAgentInstructions는 역할 + 슬림메뉴 JSON을 포함한다", () => {
    const instructions = buildAgentInstructions(menu);
    expect(instructions).toContain("카페라떼");
    expect(instructions).toContain("caffe-latte-003");
    expect(instructions.toLowerCase()).toContain("select_item");
  });
});
