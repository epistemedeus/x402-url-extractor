import {
  CALLER_RESULT_FEEDBACK_HEADER,
  CALLER_RESULT_FEEDBACK_PATH,
} from "../../../caller-result-feedback.mjs";
import { attachCallerResultFeedbackHeader } from "../../../caller-result-feedback.mjs";
import { OBSERVATION_LINK, PRIOR_CAPABILITY_HEADER, usefulServiceObservationPublicContract } from "./contract.mjs";

export function decoratePaidResponse(res, input = {}) {
  const attached = attachCallerResultFeedbackHeader(res, input);
  if (!attached) return false;
  res.append("Link", OBSERVATION_LINK);
  return true;
}

export function mountUsefulServiceObservation(app, observation) {
  app.get(CALLER_RESULT_FEEDBACK_PATH, (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json(usefulServiceObservationPublicContract());
  });
  app.post(CALLER_RESULT_FEEDBACK_PATH, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const result = await observation.submitExtension({
      token: req.get(CALLER_RESULT_FEEDBACK_HEADER) || "",
      priorCapability: req.get(PRIOR_CAPABILITY_HEADER) || "",
      body: req.body,
      rawBody: req.rawBody,
      query: req.query,
    });
    return res.status(result.statusCode).json(result.body);
  });
  return app;
}

export { OBSERVATION_LINK, CALLER_RESULT_FEEDBACK_PATH, CALLER_RESULT_FEEDBACK_HEADER };
