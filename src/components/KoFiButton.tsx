import Image from "next/image";
import { Button } from "./ui/button";

const KoFiButton = () => {
  return (
    <Button
      asChild
      className="h-auto max-w-full whitespace-normal"
      variant="outline"
    >
      <a
        href="https://ko-fi.com/W7W512ZD8I"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="relative mr-2 h-8 w-8 shrink-0">
          <Image
            src={"/kofi_logo.png"}
            alt=""
            fill
            sizes="32px"
            className="object-contain"
          />
        </span>
        <span>Report errors or support this tool</span>
      </a>
    </Button>
  );
};

export default KoFiButton;
