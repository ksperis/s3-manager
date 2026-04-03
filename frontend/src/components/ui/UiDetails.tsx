import { ComponentPropsWithoutRef, useEffect, useState } from "react";

type UiDetailsProps = Omit<ComponentPropsWithoutRef<"details">, "open"> & {
  defaultOpen?: boolean;
};

export default function UiDetails({ defaultOpen = false, onToggle, ...props }: UiDetailsProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
    }
  }, [defaultOpen]);

  return (
    <details
      {...props}
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        onToggle?.(event);
      }}
    />
  );
}
