function download(name: string, file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // The browser reads the blob after the click returns, so let it go a little later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Hands the backup to the person: through the phone's share sheet where the browser can share a
 * file, otherwise as a download. "cancelled" is a share sheet closed without choosing anywhere.
 * A share the browser refuses for any other reason (it wants a fresh tap, say) falls back to a download.
 */
export async function shareOrDownload(name: string, json: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([json], name, { type: "application/json" });
  const data = { files: [file], title: name };

  if (typeof navigator.canShare === "function" && typeof navigator.share === "function" && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
      console.warn("Eat the World: sharing the backup failed; downloading it instead", error);
    }
  }
  download(name, file);
  return "downloaded";
}
