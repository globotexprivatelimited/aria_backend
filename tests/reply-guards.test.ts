import { dropDanglingPointer, guardModelReply, setStatedAmounts, type Catalog } from "../src/menu/catalog";

const catalogOf = (prices: number[]): Catalog => ({ items: prices.map((price, i) => ({ id: String(i), code: "F" + i, name: "Dish " + i, price })), byCode: new Map(), slots: [], promptText: "", configured: {}, timezone: null, now: new Date() }) as unknown as Catalog;

describe("a reply is never emptied by its own guards", () => {
  test("details that follow a colon or a line break are kept", () => {
    const wifi = "Here are the Wi-Fi details:\n\nWi-Fi name: *Air_Maha*\nPassword: *Air@19805*\n\nLet me know if you have any trouble connecting!";
    expect(dropDanglingPointer(wifi)).toBe(wifi);
    expect(dropDanglingPointer("Here is the menu below\n- Tea\n- Coffee")).toBe("Here is the menu below\n- Tea\n- Coffee");
  });
  test("details inside the same sentence are kept", () => {
    const one = "Here are the Wi-Fi details - name *Air_Maha*, password *Air@19805*.";
    expect(dropDanglingPointer(one)).toBe(one);
  });
  test("a pointer to details that never come is dropped, and only that sentence", () => {
    expect(dropDanglingPointer("Check-out is at 12:00 noon. You will find the details below.")).toBe("Check-out is at 12:00 noon.");
    expect(dropDanglingPointer("You can see the options below. Would you like anything?")).toBe("Would you like anything?");
    expect(dropDanglingPointer("Breakfast is at 7.")).toBe("Breakfast is at 7.");
  });
  test("prices the hotel states outside the menu pass the price guard; invented ones still do not", () => {
    const c = catalogOf([150]);
    const reply = "Check-out is at 12:00 noon. Late check-out until 3 pm is \u20B9800 and until 6 pm is \u20B91,500.";
    expect(guardModelReply(reply, c)).toBe("Check-out is at 12:00 noon.");
    setStatedAmounts(c, [800, 1500, 200]);
    expect(guardModelReply(reply, c)).toBe(reply);
    expect(guardModelReply("In-room breakfast is \u20B9200 per tray.", c)).toBe("In-room breakfast is \u20B9200 per tray.");
    expect(guardModelReply("Breakfast is included. A tray is \u20B9999.", c)).toBe("Breakfast is included.");
  });
});
