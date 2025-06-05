/**
 * Capitalizes the first letter of a string and converts the rest to lowercase
 * @param text The string to capitalize
 * @returns The capitalized string
 */
export const capitalizeFirstLetter = (text: string): string => {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};
