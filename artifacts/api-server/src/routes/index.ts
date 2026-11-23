import { Router, type IRouter } from "express";
import healthRouter from "./health";
import complianceRouter from "./compliance";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(complianceRouter);

export default router;
