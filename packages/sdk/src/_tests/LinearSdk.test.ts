import { LinearSdk } from "../index";

function resolveWithData(data: unknown) {
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Promise.resolve(data) as any;
  };
}

describe("LinearSdk", () => {
  it("returns data", async () => {
    const sdk = new LinearSdk(resolveWithData({ team: { id: "qwe" } }));
    const response = await sdk.team("asd");

    expect(response).toEqual(expect.objectContaining({ id: "qwe" }));
  });

  it("catches errors", async () => {
    const sdk = new LinearSdk(() => {
      throw new Error("test error");
    });

    try {
      await sdk.viewer;
    } catch (error) {
      expect(error.message).toEqual(expect.stringContaining("test error"));
    }
  });
});
