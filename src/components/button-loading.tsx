import { ReloadIcon } from "@radix-ui/react-icons";
import { Button } from "./ui/button";

export function ButtonLoading() {
  return (
    <Button className="w-1/4" disabled>
      <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />
      Please wait
    </Button>
  );
}
