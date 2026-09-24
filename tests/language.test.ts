import { detectLanguage } from "../src/agent/language";

describe("the reply follows the language of the latest message", () => {
  test("English stays English even after Hinglish history", () => {
    expect(detectLanguage("whats fro dinner?")).toBe("English");
    expect(detectLanguage("Any blanket available because it feels winter")).toBe("English");
  });
  test("Hinglish, Benglish and scripts", () => {
    expect(detectLanguage("2 samosa bhej do")).toBe("Hinglish");
    expect(detectLanguage("spa kab khulta hai")).toBe("Hinglish");
    expect(detectLanguage("amar ekta towel lagbe")).toBe("Benglish");
    expect(detectLanguage("\u0915\u092E\u0930\u0947 \u092E\u0947\u0902 \u092A\u093E\u0928\u0940 \u092D\u0947\u091C\u094B")).toBe("Hindi");
    expect(detectLanguage("ok")).toBe("unknown");
  });
});
