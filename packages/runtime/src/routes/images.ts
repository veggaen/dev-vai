import type { FastifyInstance } from 'fastify';
import type { IngestPipeline, ChatService } from '@vai/core';

export function registerImageRoutes(
  app: FastifyInstance,
  pipeline: IngestPipeline,
  chatService: ChatService,
) {
  /**
   * Upload an image for training. Requires a description (at least 1 true fact).
   * Body: { data: base64, mimeType: string, filename?: string, description: string, question?: string }
   */
  app.post<{
    Body: {
      data: string;
      mimeType: string;
      filename?: string;
      description: string;
      question?: string;
      width?: number;
      height?: number;
      sizeBytes?: number;
      sourceUrl?: string;
      conversationId?: string;
    };
  }>('/api/images', async (request, reply) => {
    const { data, mimeType, description, filename, question, width, height, sizeBytes, sourceUrl, conversationId } = request.body;

    // Validate required fields
    if (!data || !mimeType) {
      return reply.status(400).send({ error: 'Missing image data or mimeType' });
    }
    if (!description || description.trim().length < 3) {
      return reply.status(400).send({ error: 'Description is required (at least 1 true fact about the image)' });
    }

    // Validate mime type
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];
    if (!validTypes.includes(mimeType)) {
      return reply.status(400).send({ error: `Invalid image type: ${mimeType}. Supported: ${validTypes.join(', ')}` });
    }

    // Validate size (max 10MB base64 — ~7.5MB raw)
    if (data.length > 10 * 1024 * 1024) {
      return reply.status(400).send({ error: 'Image too large (max 10MB)' });
    }

    const result = pipeline.ingestImage({
      data,
      mimeType,
      filename,
      description: description.trim(),
      question: question?.trim(),
      width,
      height,
      sizeBytes,
      sourceUrl,
      conversationId,
    });

    return result;
  });

  /**
   * List all images (metadata only, no blobs).
   */
  app.get<{ Querystring: { limit?: string; conversationId?: string } }>(
    '/api/images',
    async (request) => {
      const { limit, conversationId } = request.query;
      if (conversationId) {
        return chatService.listImages(conversationId);
      }
      return pipeline.listImages(limit ? Number(limit) : 50);
    },
  );

  /**
   * Get a single image by ID (includes base64 data).
   */
  app.get<{ Params: { id: string } }>(
    '/api/images/:id',
    async (request, reply) => {
      const image = pipeline.getImage(request.params.id);
      if (!image) {
        return reply.status(404).send({ error: 'Image not found' });
      }
      return image;
    },
  );

  /**
   * Get the raw image data (for rendering in <img> tags).
   */
  app.get<{ Params: { id: string } }>(
    '/api/images/:id/raw',
    async (request, reply) => {
      const image = pipeline.getImage(request.params.id);
      if (!image) {
        return reply.status(404).send({ error: 'Image not found' });
      }

      const buffer = Buffer.from(image.data, 'base64');
      return reply
        .header('Content-Type', image.mimeType)
        .header('Content-Length', buffer.length)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(buffer);
    },
  );
}
