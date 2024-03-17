import { useState } from "react";
import { api } from "~/utils/api";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import extractImgurId from "~/utils/link-cleaner";
import { copyToClipboard, shuffleLinks, toggleImgTagsOnLinks } from "~/utils/formatter";
import { ButtonLoading } from "~/components/button-loading";

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
    <div className="px-4 py-12">
      <div className="flex flex-col items-center space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">Imgur Direct Link Grabber v2</h1>
          <p className="text-lg text-gray-500 dark:text-gray-400">
            Enter an Imgur gallery URL to get image direct links.
          </p>
        </div>
        <div className="w-full max-w-md space-y-4">
          <div className="space-y-2">
            <Label className="text-lg font-semibold" htmlFor="url">Gallery URL</Label>
            <Input
              className="w-full"
              id="url"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="https://imgur.com/..."
            />
          </div>
          {isLoading ? (
            <ButtonLoading />
          ) : (
            <Button className="w-full" onClick={handleSubmit}>Submit</Button>
          )}
        </div>
        {error && <p>Error fetching images: {error.message}</p>}
        <div className="w-full max-w-md flex">
          <div className="w-2/3 pr-2 space-y-4">
            <Textarea value={textareaValue} readOnly className="h-64 w-full text-xs" />
          </div>
          <div className="w-1/3 flex flex-col space-y-4">
            <Button variant="secondary" onClick={() => copyToClipboard(textareaValue)} disabled={!textareaValue}>Copy to Clipboard</Button>
            <Button variant="secondary" onClick={() => handleShuffleLinks()} disabled={!textareaValue}>Shuffle Links</Button>
            <Button variant="secondary" onClick={() => handleWrapLinks()} disabled={!textareaValue}>Toggle IMG Tags</Button>
          </div>
        </div>
      </div>
    </div>
  );
}