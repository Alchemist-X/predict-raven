// Boundary validation for explicit answer contracts; omitted fields are inferred.
import { z } from "zod";

export const AnswerRequestSchema = z
  .object({
    answerType: z.enum(["auto", "binary", "categorical", "numeric", "independent_ranking"]).optional(),
    options: z
      .array(z.object({ id: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,40}$/), label: z.string().trim().min(1).max(200) }).strict())
      .min(2)
      .max(20)
      .optional(),
    unit: z.string().trim().min(1).max(100).optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    resolution: z.string().trim().min(1).max(8000).optional()
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.minimum !== undefined && request.maximum !== undefined && request.minimum >= request.maximum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maximum"],
        message: "maximum must exceed minimum / 上限必须大于下限"
      });
    }
    if (request.options && (new Set(request.options.map((option) => option.id.toLowerCase())).size !== request.options.length || new Set(request.options.map((option) => option.label.toLowerCase())).size !== request.options.length)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "option ids and labels must be unique / 选项标识与名称不能重复"
      });
    }
    if ((request.answerType === "binary" || request.answerType === "numeric") && request.options) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "options require a categorical or ranking answer / 选项仅用于分类或排名"
      });
    }
    if (
      request.answerType &&
      !["auto", "numeric"].includes(request.answerType) &&
      (request.unit !== undefined || request.minimum !== undefined || request.maximum !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "units and bounds require a numeric answer / 单位与上下限仅用于数值预测"
      });
    }
  });
