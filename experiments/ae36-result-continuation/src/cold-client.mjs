// The shipped continuation is the caller archive module.
// These names stay here so the conformance tests keep one import path.
export {
  REPORT_RESULT,
  RETRIEVE_ENTITLED,
  NEW_PAID_TASK,
  actionParity,
  matchesSupportedNextActions,
  discoverHttpNextActions,
  discoverSdkNextActions,
  bindHttpResult,
  classifyHttpExchange,
  classifySdkResult,
  reportHttpResult,
  reportSdkResult,
  readSdkCapability,
  retrieveEntitledHttp,
  feedbackBearerOnResult,
} from "../../../caller-result-client/src/continuation.mjs";
