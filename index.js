require("dotenv").config();

const express = require("express");
const app = express();
const port = 8000;
app.use(express.json()); // parse json request body

const bcryptjs = require("bcryptjs");
const jwt = require("jwt-simple");
const { v4: uuidv4 } = require("uuid");

const AWS = require("aws-sdk");
AWS.config.update({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const dynamodbClient = new AWS.DynamoDB.DocumentClient();

// jwt verification middleware
const checkJwt = (req, res, next) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: "No jwt token provided" });
    return;
  }
  let decoded;
  try {
    decoded = jwt.decode(
      req.headers.authorization.split(" ")[1],
      process.env.JWT_SECRET_KEY
    );
  } catch (error) {
    res.status(401).json({ error: "Invalid jwt token" });
    return;
  }
  if (decoded.iat + 86400000 < Date.now()) {
    // 1 day = 86400000 millisec
    res.status(401).json({ error: "Expired jwt token" });
    return;
  }
  req.user = decoded;
  return next();
};

/* login api */
app.post("/login", async (req, res) => {
  // validation of inputs
  if (!req.body.username || !req.body.username.trim()) {
    res.status(400).json({ error: "Username invalid" });
    return;
  }
  if (!req.body.password || !req.body.password.trim()) {
    res.status(400).json({ error: "Password invalid" });
    return;
  }
  try {
    // fetch user row from database
    let user = await dynamodbClient
      .get({
        TableName: "VirtualClassroom-User",
        Key: {
          username: req.body.username,
        },
      })
      .promise();
    if (!user.Item) {
      res.status(401).json({ error: "User does not exist" });
      return;
    }
    user = user.Item;
    // compare password
    const isPasswordCorrect = await bcryptjs.compare(
      req.body.password,
      user.password
    );
    if (!isPasswordCorrect) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    // create jwt
    const token = jwt.encode(
      {
        username: user.username,
        usertype: user.usertype,
        iat: Date.now(), // jwt issued at
      },
      process.env.JWT_SECRET_KEY
    );
    res.status(200).json({ jwt: token });
    return;
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Internal error" });
    return;
  }
});

/* create assignment api */
app.post("/assignments", checkJwt, async (req, res) => {
  if (req.user.usertype !== "tutor") {
    res.status(403).json({ error: "Forbidden for non-tutor user" });
    return;
  }
  // validation of inputs
  if (!req.body.description || !req.body.description.trim()) {
    res.status(400).json({ error: "Description invalid" });
    return;
  }
  if (!req.body.deadline || req.body.deadline <= Date.now()) {
    res.status(400).json({ error: "Deadline invalid" });
    return;
  }
  if (!req.body.students || req.body.students.length === 0) {
    res.status(400).json({ error: "Students list invalid" });
    return;
  }
  if (req.body.publishedat && req.body.publishedat < Date.now()) {
    res.status(400).json({ error: "Published at invalid" });
    return;
  }
  try {
    // create assignment row
    const assignment = {
      tutorid: req.user.username,
      assignmentid: uuidv4(),
      publishedat: req.body.publishedat ? req.body.publishedat : Date.now(),
      description: req.body.description,
      deadline: req.body.deadline,
    };
    await dynamodbClient
      .put({
        TableName: "VirtualClassroom-Assignments",
        Item: assignment,
      })
      .promise();
    // create submission rows
    for (let i = 0; i < req.body.students.length; i++) {
      const submission = {
        assignmentid: assignment.assignmentid,
        studentid: req.body.students[i],
        remark: "",
        submissionid: uuidv4(),
        submittedat: 0,
      };
      await dynamodbClient
        .put({
          TableName: "VirtualClassroom-Submissions",
          Item: submission,
        })
        .promise();
    }
    res.status(200).json({ assignment: assignment });
    return;
  } catch (error) {
    res.status(500).json({ error: "Internal error" });
    return;
  }
});

/* delete assignment api */
app.delete("/assignments/:assignmentid", checkJwt, async (req, res) => {
  if (req.user.usertype !== "tutor") {
    res.status(403).json({ error: "Forbidden for non-tutor user" });
    return;
  }
  try {
    // check assignment valid
    const assignment = await dynamodbClient
      .get({
        TableName: "VirtualClassroom-Assignments",
        Key: {
          assignmentid: req.params.assignmentid,
        },
      })
      .promise();
    if (!assignment.Item) {
      res.status(400).json({ error: "Invalid assignment" });
      return;
    }
    // delete assignment row
    await dynamodbClient
      .delete({
        TableName: "VirtualClassroom-Assignments",
        Key: {
          assignmentid: req.params.assignmentid,
        },
      })
      .promise();
    // delete submissions rows
    let submissions = await dynamodbClient
      .query({
        TableName: "VirtualClassroom-Submissions",
        KeyConditionExpression: "assignmentid = :assignmentid",
        ExpressionAttributeValues: {
          ":assignmentid": req.params.assignmentid,
        },
      })
      .promise();
    submissions = submissions.Items;
    for (let i = 0; i < submissions.length; i++) {
      await dynamodbClient
        .delete({
          TableName: "VirtualClassroom-Submissions",
          Key: {
            assignmentid: req.params.assignmentid,
            studentid: submissions[i].studentid,
          },
        })
        .promise();
    }
    res.status(200).json({ assignment });
    return;
  } catch (error) {
    res.status(500).json({ error: "Internal error" });
    return;
  }
});

/* update assignment api */
app.put("/assignments/:assignmentid", checkJwt, async (req, res) => {
  if (req.user.usertype !== "tutor") {
    res.status(403).json({ error: "Forbidden for non-tutor user" });
    return;
  }
  // validation of inputs
  if (req.body.description && !req.body.description.trim()) {
    res.status(400).json({ error: "Description invalid" });
    return;
  }
  if (req.body.deadline && req.body.deadline <= Date.now()) {
    res.status(400).json({ error: "Deadline invalid" });
    return;
  }
  if (req.body.publishedat && req.body.publishedat < Date.now()) {
    res.status(400).json({ error: "Published at invalid" });
    return;
  }
  if (req.body.students && req.body.students.length === 0) {
    res.status(400).json({ error: "Students list invalid" });
    return;
  }
  try {
    // check valid assignment
    let assignment = await dynamodbClient
      .get({
        TableName: "VirtualClassroom-Assignments",
        Key: {
          assignmentid: req.params.assignmentid,
        },
      })
      .promise();
    if (!assignment.Item) {
      res.status(400).json({ error: "Invalid assignment" });
      return;
    }
    assignment = assignment.Item;
    // update  assignment with new values
    req.body.description && (assignment.description = req.body.description);
    req.body.deadline && (assignment.deadline = req.body.deadline);
    req.body.publishedat && (assignment.publishedat = req.body.publishedat);
    await dynamodbClient
      .put({
        TableName: "VirtualClassroom-Assignments",
        Item: assignment,
      })
      .promise();
    // if update in students list
    if (req.body.students) {
      let old_students = await dynamodbClient
        .query({
          TableName: "VirtualClassroom-Submissions",
          KeyConditionExpression: "#key1 = :value1",
          ExpressionAttributeNames: {
            "#key1": "assignmentid",
          },
          ExpressionAttributeValues: {
            ":value1": req.params.assignmentid,
          },
        })
        .promise();
      old_students = old_students.Items;
      let toRemove = old_students.filter(
        (item) => !req.body.students.includes(item.studentid)
      );
      let toAdd = req.body.students.filter(
        (item1) => !old_students.find((item2) => item2.studentid === item1)
      );
      toRemove = toRemove.map((item) => item.studentid);
      for (let i = 0; i < toRemove.length; i++) {
        await dynamodbClient
          .delete({
            TableName: "VirtualClassroom-Submissions",
            Key: {
              assignmentid: req.params.assignmentid,
              studentid: toRemove[i],
            },
          })
          .promise();
      }
      for (let i = 0; i < toAdd.length; i++) {
        const submission = {
          assignmentid: req.params.assignmentid,
          studentid: toAdd[i],
          remark: "",
          submissionid: uuidv4(),
          submittedat: 0,
        };
        await dynamodbClient
          .put({
            TableName: "VirtualClassroom-Submissions",
            Item: submission,
          })
          .promise();
      }
    }
    res.status(200).json({ assignment });
    return;
  } catch (error) {
    res.status(500).json({ error: "Internal error" });
    return;
  }
});

/* create submission api */
app.post(
  "/assignments/:assignmentid/submissions",
  checkJwt,
  async (req, res) => {
    if (req.user.usertype !== "student") {
      res.status(403).json({ error: "Forbidden for non-student user" });
      return;
    }
    // validation of inputs
    if (!req.body.remark || !req.body.remark.trim()) {
      res.status(400).json({ error: "Remark invalid" });
      return;
    }
    try {
      // check valid assignment
      console.log(req.params.assignmentid, req.user.username);
      let submission = await dynamodbClient
        .get({
          TableName: "VirtualClassroom-Submissions",
          Key: {
            assignmentid: req.params.assignmentid,
            studentid: req.user.username,
          },
        })
        .promise();
      if (!submission.Item) {
        res.status(400).json({ error: "Invalid assignment" });
        return;
      }
      submission = submission.Item;
      if (submission.submittedat) {
        res.status(409).json({ error: "Submission already exists" });
        return;
      }
      // add submission
      submission.remark = req.body.remark;
      submission.submittedat = Date.now();
      await dynamodbClient
        .put({
          TableName: "VirtualClassroom-Submissions",
          Item: submission,
        })
        .promise();
      res.status(200).json({ submission });
      return;
    } catch (error) {
      res.status(500).json({ error: "Internal error" });
      return;
    }
  }
);

/* get assignment api */
app.get("/assignments/:assignmentid", checkJwt, async (req, res) => {
  if (req.user.usertype === "student") {
    try {
      let submission = await dynamodbClient
        .get({
          TableName: "VirtualClassroom-Submissions",
          Key: {
            assignmentid: req.params.assignmentid,
            studentid: req.user.username,
          },
        })
        .promise();
      // check valid assignment
      if (!submission.Item) {
        res.status(400).json({ error: "Invalid assignment" });
        return;
      }
      submission = submission.Item;
      // if submission not added
      if (!submission.submittedat) {
        res.status(200).json({ submission: {} });
        return;
      }
      res.status(200).json({ submission });
      return;
    } catch (error) {
      res.status(500).json({ error: "Internal error" });
      return;
    }
  }
  if (req.user.usertype === "tutor") {
    try {
      const assignment = await dynamodbClient
        .get({
          TableName: "VirtualClassroom-Assignments",
          Key: {
            assignmentid: req.params.assignmentid,
          },
        })
        .promise();
      // check valid assignment
      if (!assignment.Item) {
        res.status(400).json({ error: "Invalid assignment" });
        return;
      }
      let submissions = await dynamodbClient
        .query({
          TableName: "VirtualClassroom-Submissions",
          IndexName: "assignmentid-submittedat-index",
          KeyConditionExpression: "#key1 = :value1 AND #key2 > :value2", // ne not available for sort key in KCE
          ExpressionAttributeNames: {
            "#key1": "assignmentid",
            "#key2": "submittedat",
          },
          ExpressionAttributeValues: {
            ":value1": req.params.assignmentid,
            ":value2": 0,
          },
        })
        .promise();
      submissions = submissions.Items;
      res.status(200).json({ submissions });
      return;
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: "Internal error" });
      return;
    }
  }
});

/* list assignments api */
app.get("/assignments", checkJwt, async (req, res) => {
  if (req.user.usertype === "tutor") {
    try {
      // filter validation
      !req.query.published_status && (req.query.published_status = "ALL");
      if (
        !["ALL", "SCHEDULED", "ONGOING"].includes(req.query.published_status)
      ) {
        res.status(400).json({ error: "Invalid published_status filter" });
        return;
      }
      // filter expression calculations
      let kce, ean, eav;
      if (req.query.published_status === "ALL") {
        kce = "#key1 = :value1";
        ean = {
          "#key1": "tutorid",
        };
        eav = {
          ":value1": req.user.username,
        };
      } else if (req.query.published_status === "SCHEDULED") {
        kce = "#key1 = :value1 AND #key2 > :value2";
        ean = {
          "#key1": "tutorid",
          "#key2": "publishedat",
        };
        eav = {
          ":value1": req.user.username,
          ":value2": Date.now(),
        };
      } else if (req.query.published_status === "ONGOING") {
        kce = "#key1 = :value1 AND #key2 <= :value2";
        ean = {
          "#key1": "tutorid",
          "#key2": "publishedat",
        };
        eav = {
          ":value1": req.user.username,
          ":value2": Date.now(),
        };
      }
      let assignments = await dynamodbClient
        .query({
          TableName: "VirtualClassroom-Assignments",
          IndexName: "tutorid-publishedat-index",
          KeyConditionExpression: kce,
          ExpressionAttributeNames: ean,
          ExpressionAttributeValues: eav,
        })
        .promise();
      assignments = assignments.Items;
      res.status(200).json({ assignments });
      return;
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: "Internal error" });
      return;
    }
  }
  if (req.user.usertype === "student") {
    try {
      // filter validation
      !req.query.published_status && (req.query.published_status = "ALL");
      !req.query.submission_status && (req.query.submission_status = "ALL");
      if (
        !["ALL", "SCHEDULED", "ONGOING"].includes(req.query.published_status)
      ) {
        res.status(400).json({ error: "Invalid published_status filter" });
        return;
      }
      if (
        !["ALL", "PENDING", "OVERDUE", "SUBMITTED"].includes(
          req.query.submission_status
        )
      ) {
        res.status(400).json({ error: "Invalid submission_status filter" });
        return;
      }
      // calculate submission_status filter
      let kce, ean, eav;
      if (req.query.submission_status === "ALL") {
        kce = "#key1 = :value1";
        ean = {
          "#key1": "studentid",
        };
        eav = {
          ":value1": req.user.username,
        };
      } else if (req.query.submission_status === "SUBMITTED") {
        kce = "#key1 = :value1 AND #key2 > :value2"; // ne not available for sort key in KCE
        ean = {
          "#key1": "studentid",
          "#key2": "submittedat",
        };
        eav = {
          ":value1": req.user.username,
          ":value2": 0,
        };
      } else if (
        req.query.submission_status === "PENDING" ||
        req.query.submission_status === "OVERDUE" // overdue is subset of pending
      ) {
        kce = "#key1 = :value1 AND #key2 = :value2"; // ne not available for sort key in KCE
        ean = {
          "#key1": "studentid",
          "#key2": "submittedat",
        };
        eav = {
          ":value1": req.user.username,
          ":value2": 0,
        };
      }
      let submissions = await dynamodbClient
        .query({
          TableName: "VirtualClassroom-Submissions",
          IndexName: "studentid-submittedat-index",
          KeyConditionExpression: kce,
          ExpressionAttributeNames: ean,
          ExpressionAttributeValues: eav,
        })
        .promise();
      submissions = submissions.Items;
      // get assignments from Assignment table
      let assignments = [];
      for (let i = 0; i < submissions.length; i++) {
        const assignment = await dynamodbClient
          .get({
            TableName: "VirtualClassroom-Assignments",
            Key: {
              assignmentid: submissions[i].assignmentid,
            },
          })
          .promise();
        assignments.push(assignment.Item);
      }
      // if overdue submission_status filter, apply it
      if (req.query.submission_status === "OVERDUE") {
        assignments = assignments.filter((item) => item.deadline < Date.now());
      }
      // apply published_status filter
      if (req.query.published_status === "SCHEDULED") {
        assignments = assignments.filter(
          (item) => item.publishedat > Date.now()
        );
      } else if (req.query.published_status === "ONGOING") {
        assignments = assignments.filter(
          (item) => item.publishedat <= Date.now()
        );
      } else if (req.query.published_status === "ALL") {
        assignments = assignments;
      }
      res.status(200).json({ assignments });
      return;
    } catch (error) {
      res.status(500).json({ error: "Internal error" });
      return;
    }
  }
});

app.listen(port, () => console.log(`Server running on ${port}.`));
