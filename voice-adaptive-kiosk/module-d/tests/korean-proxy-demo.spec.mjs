import { test, expect } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";

test.use({
  viewport: { width: 1500, height: 980 },
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("Korean senior proxy demo starts standard-only, then compares standard and adaptive through payment", async ({ page }) => {
  let analyzeCalls = 0;
  let proxyCalls = 0;
  let proxyBody = {};
  let groundCalls = 0;
  const groundSteps = [];
  const groundBodies = [];
  const generateBodies = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/analyze") {
      await route.fallback();
      return;
    }
    analyzeCalls += 1;
    const transcript =
      analyzeCalls === 1
        ? "아이스 바닐라 라떼 큰 사이즈로 포장해주세요"
        : "vanilla latte";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        transcript,
        language: analyzeCalls === 1 ? "ko" : "en",
        age: {
          group: "senior_adult",
          years_est: 76.3,
          confidence: 0.91,
          child_prob: 0,
        },
        behavioral: {
          speech_rate: 2.1,
          silence_ratio: 0.18,
          filler_count: 0,
          assist_level: 2,
        },
        duration_ms: 1200,
      }),
    });
  });

  await page.route("**/demo/korean-senior-proxy/analyze", async (route) => {
    proxyCalls += 1;
    proxyBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        korean_text: "아이스 바닐라 라떼 큰 사이즈로 포장해주세요",
        english_proxy_text: "I would like an iced large vanilla latte, please. Please guide me slowly with large text.",
        voice_id: "pqHfZKP75CvOlQylNhV4",
        age: {
          group: "senior_adult",
          years_est: 76.3,
          confidence: 0.91,
          child_prob: 0,
        },
        behavioral: {
          speech_rate: 2.1,
          silence_ratio: 0.18,
          filler_count: 0,
          assist_level: 2,
        },
        duration_ms: 340,
        audio_base64: "",
      }),
    });
  });

  await page.route("**/ground-intent", async (route) => {
    groundCalls += 1;
    const body = route.request().postDataJSON();
    groundSteps.push(body.step);
    groundBodies.push(body);
    const selectedItem = body.menu_context.find((item) => item.id === "vanilla-latte-004");
    const groundedByStep = {
      recommend: {
        intent: "select_item",
        item_candidates: [
          { item_id: "vanilla-latte-004", confidence: 0.96 },
          { item_id: "caffe-latte-003", confidence: 0.84 },
          { item_id: "caramel-latte-006", confidence: 0.78 },
        ],
        selected_options: {},
        fulfillment: null,
        loyalty: null,
        payment_method: null,
        confirm: null,
      },
      options: {
        intent: "set_options",
        item_candidates: [],
        selected_options: { Temperature: "Iced", Size: "Large" },
        fulfillment: null,
        loyalty: null,
        payment_method: null,
        confirm: null,
      },
      fulfillment: {
        intent: "set_fulfillment",
        item_candidates: [],
        selected_options: {},
        fulfillment: "Take Out",
        loyalty: null,
        payment_method: null,
        confirm: null,
      },
      loyalty: {
        intent: "set_loyalty",
        item_candidates: [],
        selected_options: {},
        fulfillment: null,
        loyalty: "none",
        payment_method: null,
        confirm: null,
      },
      payment: {
        intent: "set_payment",
        item_candidates: [],
        selected_options: {},
        fulfillment: null,
        loyalty: null,
        payment_method: "Credit Card",
        confirm: null,
      },
      confirm: {
        intent: "confirm",
        item_candidates: [],
        selected_options: {},
        fulfillment: null,
        loyalty: null,
        payment_method: null,
        confirm: "yes",
      },
    }[body.step] ?? {
      intent: "unknown",
      item_candidates: [],
      selected_options: {},
      fulfillment: null,
      loyalty: null,
      payment_method: null,
      confirm: null,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        step: body.step,
        ...groundedByStep,
        needs_clarification: false,
        clarification_reason: null,
        _selected_item_name: selectedItem?.name,
      }),
    });
  });

  await page.route("**/generate-ui", async (route) => {
    const request = route.request().postDataJSON();
    generateBodies.push(request);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-GGUI-Path": "local-test" },
      body: JSON.stringify({
        render_id: `test-${request.step}`,
        embed_url: "",
        contract: {
          _test: true,
          _step: request.step,
          _assist_level: request.assist_level,
          _age_group: request.age_group,
          _transcript: request.transcript,
          _order_state: request.order_state,
        },
      }),
    });
  });

  await page.goto(baseURL);

  await expect(page.getByLabel("Standard kiosk before screen")).toBeVisible();
  await expect(page.getByLabel("Adaptive kiosk after screen")).toHaveCount(0);
  await expect(page.getByText("Adaptive / After")).toHaveCount(0);
  await expect(page.getByText(/Senior|Younger/)).toHaveCount(0);

  await page.getByRole("button", { name: "Voice 2" }).click();
  await page.getByRole("button", { name: /Start Voice Order/i }).click();
  await expect(page.getByRole("button", { name: /Stop Speaking/i })).toBeVisible();
  await page.getByRole("button", { name: /Stop Speaking/i }).click();

  await expect.poll(() => analyzeCalls).toBeGreaterThan(0);
  await expect.poll(() => proxyCalls).toBeGreaterThan(0);
  await expect.poll(() => proxyBody).toMatchObject({
    text: "아이스 바닐라 라떼 큰 사이즈로 포장해주세요",
    voice_id: "pqHfZKP75CvOlQylNhV4",
  });
  await expect(page.getByLabel("Standard kiosk comparison pane")).toBeVisible();
  await expect(page.getByLabel("Adaptive kiosk after screen")).toBeVisible();
  await expect.poll(() => groundCalls).toBeGreaterThan(0);
  await expect.poll(() => generateBodies[0]?.menu_context?.[0]?.id).toBe("vanilla-latte-004");
  expect(generateBodies[0].menu_context.length).toBeLessThanOrEqual(5);
  await expect(page.getByText(/Korean order|English proxy|senior proxy|Age model|bridge|model demo|Senior demo voice/i)).toHaveCount(0);
  await expect(page.getByText(/Analyze \(A\)|Adaptive UI \(C\)|localhost|assist_level|Age Group|Transcript|Speech Rate|MOCK/i)).toHaveCount(0);
  await expect(page.getByText(/large text/i)).toHaveCount(0);

  const initialProxyCalls = proxyCalls;
  await expect(page.locator(".mic-bar").getByRole("button", { name: /Speak Next/i })).toBeVisible();
  await page.locator(".mic-bar").getByRole("button", { name: /Speak Next/i }).click();
  await expect(page.getByRole("button", { name: /Stop Speaking/i })).toBeVisible();
  await page.getByRole("button", { name: /Stop Speaking/i }).click();
  await expect.poll(() => analyzeCalls).toBeGreaterThan(1);
  await expect.poll(() => proxyCalls).toBe(initialProxyCalls);

  const standardFrame = await page.locator(".compare-pane.standard .kiosk-frame").boundingBox();
  const adaptiveFrame = await page.locator(".compare-pane.adaptive .kiosk-frame").boundingBox();
  expect(standardFrame?.height || 0).toBeGreaterThan(700);
  expect(standardFrame?.width || 0).toBeGreaterThan(700);
  expect(adaptiveFrame?.height || 0).toBeGreaterThan(700);

  await expect(page.getByRole("heading", { name: /^Options$/i })).toBeVisible();

  await page.getByLabel("Demo voice turn").fill("iced large");
  await page.getByRole("button", { name: /Send as Voice/i }).click();
  await expect(page.getByText(/Eat here or take out/i)).toBeVisible();
  await expect(page.getByText(/take out/i).first()).toBeVisible();
  await expect(page.locator(".compare-pane.standard .standard-mini-rail span.active b")).toHaveText("3");
  await expect(page.locator(".compare-pane.adaptive .step-rail span.active")).toHaveText("3");

  await page.getByLabel("Demo voice turn").fill("take out");
  await page.getByRole("button", { name: /Send as Voice/i }).click();
  await expect(page.getByText(/Coupons or points/i)).toBeVisible();
  await expect(page.getByText(/skip/i).first()).toBeVisible();

  await page.getByLabel("Demo voice turn").fill("skip points");
  await page.getByRole("button", { name: /Send as Voice/i }).click();
  await expect(page.getByText(/How will you pay/i)).toBeVisible();
  await expect(page.getByText(/credit card/i).first()).toBeVisible();

  await page.getByLabel("Demo voice turn").fill("credit card");
  await page.getByRole("button", { name: /Send as Voice/i }).click();
  await expect(page.getByText(/Ready to pay|Would you like to order/i)).toBeVisible();

  await page.getByLabel("Demo voice turn").fill("yes");
  await page.getByRole("button", { name: /Send as Voice/i }).click();
  await expect(page.getByText("Payment Complete!")).toBeVisible();
  expect(new Set(groundSteps)).toEqual(
    new Set(["recommend", "options", "fulfillment", "loyalty", "payment", "confirm"]),
  );
  expect(groundBodies.find((body) => body.step === "recommend")?.korean_text).toContain("바닐라 라떼");
  expect(groundBodies.find((body) => body.step === "options")?.korean_text).toBe("");
  expect(groundBodies.find((body) => body.step === "confirm")?.english_proxy_text).toBe("");
});

test("recommend request uses ground-intent candidates instead of raw full catalog", async ({ page }) => {
  let generateBody = null;
  let groundBody = null;
  await page.route("**/analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        transcript: "유자차 하나 주문해줘",
        language: "ko",
        age: {
          group: "adult",
          years_est: 38,
          confidence: 0.75,
          child_prob: 0,
        },
        behavioral: {
          speech_rate: 2.5,
          silence_ratio: 0.1,
          filler_count: 0,
          assist_level: 1,
        },
        duration_ms: 500,
      }),
    });
  });
  await page.route("**/demo/korean-senior-proxy/analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        korean_text: "유자차 하나 주문해줘",
        english_proxy_text: "I would like a yuza tea, please.",
        voice_id: "wGcFBfKz5yUQqhqr0mVy",
        age: {
          group: "senior_adult",
          years_est: 76.3,
          confidence: 0.91,
          child_prob: 0,
        },
        behavioral: {
          speech_rate: 2.1,
          silence_ratio: 0.18,
          filler_count: 0,
          assist_level: 2,
        },
        duration_ms: 340,
        audio_base64: "",
      }),
    });
  });
  await page.route("**/ground-intent", async (route) => {
    groundBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        step: "recommend",
        intent: "select_item",
        item_candidates: [{ item_id: "yuzu-tea-032", confidence: 0.94 }],
        selected_options: {},
        fulfillment: null,
        loyalty: null,
        payment_method: null,
        confirm: null,
        needs_clarification: false,
        clarification_reason: null,
      }),
    });
  });
  await page.route("**/generate-ui", async (route) => {
    generateBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-GGUI-Path": "local-test" },
      body: JSON.stringify({
        render_id: "test-yuzu",
        embed_url: "",
        contract: { _test: true },
      }),
    });
  });

  await page.goto(baseURL);
  await page.getByRole("button", { name: /Start Voice Order/i }).click();
  await page.getByRole("button", { name: /Stop Speaking/i }).click();

  await expect.poll(() => groundBody?.menu_context?.length ?? 0).toBeGreaterThan(40);
  await expect.poll(() => generateBody?.menu_context?.length ?? 0).toBe(1);
  expect(generateBody.menu_context[0].id).toBe("yuzu-tea-032");
});
