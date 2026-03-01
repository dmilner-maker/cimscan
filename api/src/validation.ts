import { z } from "zod";

// Example Zod schema for API validation
export const exampleSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export type ExampleInput = z.infer<typeof exampleSchema>;
