export const LogoTextComponent = () => {
  return (
    <div className="flex max-w-full items-center gap-[10px]">
      <img
        src="/logo.svg"
        alt=""
        aria-hidden="true"
        className="h-[34px] w-[34px] shrink-0 object-contain"
      />
      <img
        src="/postiz-text.svg"
        alt="TrendPostiz"
        className="h-[24px] max-w-[190px] object-contain brightness-0 invert"
      />
    </div>
  );
};
