describe("META_SEND=off stops every WhatsApp send", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; jest.resetModules(); });
  test("configured normally, off when META_SEND=off", () => {
    process.env.META_ACCESS_TOKEN = "t"; process.env.META_PHONE_NUMBER_ID = "123";
    delete process.env.META_SEND;
    jest.isolateModules(() => { expect(require("../src/lib/meta").isMetaConfigured()).toBe(true); });
    process.env.META_SEND = "off";
    jest.isolateModules(() => { expect(require("../src/lib/meta").isMetaConfigured()).toBe(false); });
    process.env.META_SEND = "OFF ";
    jest.isolateModules(() => { expect(require("../src/lib/meta").isMetaConfigured()).toBe(false); });
  });
});
