export function matchesWorkspaceSearch(
  query: string,
  ...values: Array<string | null | undefined>
) {
  const fold = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es")
      .trim();
  return fold(values.filter(Boolean).join(" ")).includes(fold(query));
}
