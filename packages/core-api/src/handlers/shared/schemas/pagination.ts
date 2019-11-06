import Joi from "@hapi/joi";

export const pagination = {
    page: Joi.number()
        .integer()
        .positive(),
    offset: Joi.number()
        .integer()
        .min(0),
    limit: Joi.number()
        .integer()
        .min(1),
    // todo: the container is not available at the time this file is loaded
    // .max(app.get<any>("api.options").get("plugins.pagination.limit")),
};
