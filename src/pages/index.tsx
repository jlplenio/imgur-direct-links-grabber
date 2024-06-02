import { useState } from "react";
import { api } from "~/utils/api";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import Image from "next/image";
import extractImgurId from "~/utils/link-cleaner";
import {
  copyToClipboard,
  shuffleLinks,
  toggleImgTagsOnLinks,
} from "~/utils/formatter";
import { ButtonLoading } from "~/components/button-loading";
import { ModeToggle } from "~/components/ThemeToggle";
import KoFiButton from "~/components/KoFiButton";

export default function Home() {
  const [inputValue, setInputValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");

  // Setup the mutation with useMutation hook
  const { mutateAsync, isLoading, error } = api.imgur.getLinks.useMutation();

  const handleWrapLinks = () => {
    const result = toggleImgTagsOnLinks(textareaValue);
    setTextareaValue(result);
    // Or handle the result differently as per your needs
  };

  const handleShuffleLinks = () => {
    const result = shuffleLinks(textareaValue);
    setTextareaValue(result);
    // Or handle the result differently as per your needs
  };

  async function handleSubmit() {
    if (extractImgurId(inputValue) == null) {
      setTextareaValue("Invalid URL format");
      return;
    }

    try {
      setTextareaValue("loading...");
      const data = await mutateAsync({ url: inputValue });
      setTextareaValue(data); // Assuming the mutation returns the data directly
    } catch (err) {
      console.error("Error fetching images:", err);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="w-full max-w-lg rounded-b-xl border-b border-l border-r p-5 shadow-lg">
        <div className="flex flex-col items-center space-y-8">
          <div className="space-y-4 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Imgur Direct Link Grabber v2
            </h1>
            <p className="text-l text-gray-500 dark:text-gray-400">
              Enter an Imgur URL to get image direct links.
            </p>
          </div>
          <div className="w-full max-w-md space-y-2">
            <Label className="text-l font-semibold" htmlFor="url">
              Gallery URL
            </Label>
            <div className="flex">
              <div className=" w-3/4 pr-6">
                <Input
                  id="url"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="https://imgur.com/..."
                />
              </div>
              {isLoading ? (
                <ButtonLoading />
              ) : (
                <Button className="w-1/4" onClick={handleSubmit}>
                  Go
                </Button>
              )}
            </div>
          </div>
          {error && <p>Error fetching images: {error.message}</p>}
          <div className="flex w-full max-w-md">
            <div className="w-3/4 space-y-4 pr-6">
              <Textarea
                value={textareaValue}
                readOnly
                className="h-64 w-full resize-none text-xs"
              />
            </div>
            <div className="flex w-1/4 flex-1 flex-col">
              <Button
                variant="secondary"
                onClick={() => copyToClipboard(textareaValue)}
                disabled={!textareaValue}
              >
                To Clipboard
              </Button>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={() => handleShuffleLinks()}
                disabled={!textareaValue}
              >
                Shuffle Links
              </Button>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={() => handleWrapLinks()}
                disabled={!textareaValue}
              >
                IMG Tags
              </Button>
              <div className="ml-auto mt-auto">
                <ModeToggle />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-5">
        <KoFiButton />
      </div>
      <div className="mt-3">
        <a
          href="https://github.com/jlplenio/imgur-direct-links-grabber"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            className="dark:invert"
            src="/github_logo.svg"
            alt="GitHub Mark"
            height={22}
            width={32}
          />
        </a>
      </div>
    </div>
  );
}
