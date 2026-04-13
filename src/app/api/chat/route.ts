import { NextRequest } from "next/server";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, UIMessage, convertToModelMessages } from "ai";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { MODELS } from "@/lib/models";
import { logger } from "@/lib/logger";

const openrouter = createOpenAICompatible({
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

function getTextFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const messages: UIMessage[] = body.messages;
    const modelId: string = body.modelId;

    const model = MODELS.find((m) => m.id === modelId);
    if (!model) {
      return new Response("Invalid model", { status: 400 });
    }

    const lastUserMessage = messages[messages.length - 1];
    const userText = getTextFromUIMessage(lastUserMessage);

    // Save user message to DB
    await prisma.message.create({
      data: {
        role: "user",
        content: userText,
        userId: payload.userId,
      },
    });

    logger.info(
      { userId: payload.userId, model: modelId },
      "Chat request"
    );

    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: openrouter(modelId),
      messages: modelMessages,
      onFinish: async ({ text }) => {
        await prisma.message.create({
          data: {
            role: "assistant",
            content: text,
            userId: payload.userId,
          },
        });
        logger.info(
          {
            userId: payload.userId,
            model: modelId,
            responseLength: text.length,
          },
          "Chat response completed"
        );
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    logger.error({ error, userId: payload.userId }, "Chat error");
    return new Response("Internal server error", { status: 500 });
  }
}
