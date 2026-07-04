import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
import { FileDropzone, type FileDropzoneProps } from "./ui/file-dropzone.js";

function Harness(props: Partial<FileDropzoneProps>) {
  const [files, setFiles] = useState<File[]>([]);
  return <FileDropzone value={files} onValueChange={setFiles} accept=".pdf" maxFileCount={3} {...props} />;
}
const pdf = (name = "doc.pdf", bytes = "x") => new File([bytes], name, { type: "application/pdf" });

beforeEach(() => { toast.error.mockClear(); });

describe("FileDropzone", () => {
  it("adds a valid file (onAdd fired) and shows a card", () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [pdf()] } });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByText("doc.pdf")).toBeTruthy();
  });

  it("rejects an oversize file with a toast and no card", () => {
    render(<Harness maxSize={10} />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [pdf("big.pdf", "12345678901234567890")] } });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText("big.pdf")).toBeNull();
  });

  it("rejects a file whose type is not accepted", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [new File(["x"], "note.txt", { type: "text/plain" })] } });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText("note.txt")).toBeNull();
  });

  it("removes a file via the ✕", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [pdf()] } });
    fireEvent.click(screen.getByLabelText("Remove doc.pdf"));
    expect(screen.queryByText("doc.pdf")).toBeNull();
  });

  it("hides the dropzone once maxFileCount is reached", () => {
    render(<Harness maxFileCount={1} />);
    fireEvent.change(screen.getByLabelText("Upload files"), { target: { files: [pdf("a.pdf")] } });
    expect(screen.getByText("a.pdf")).toBeTruthy();
    expect(screen.queryByLabelText("Upload files")).toBeNull();
  });

  it("accepts a file dropped onto the dropzone", () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd} />);
    const zone = screen.getByRole("button", { name: /drag/i });
    fireEvent.dragEnter(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [pdf("dropped.pdf")] } });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByText("dropped.pdf")).toBeTruthy();
  });
});
