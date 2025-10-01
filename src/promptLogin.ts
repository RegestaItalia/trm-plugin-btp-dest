import { getCommons } from "./commons";

const Commons = getCommons();

export function promptLogin(): Promise<{ email: string, password: string }> {
    return Commons.Inquirer.prompt([{
        type: `input`,
        name: `email`,
        message: `BTP Login: Email`
    },
    {
        type: `password`,
        name: `password`,
        message: `BTP Login: Password`
    }]);
}